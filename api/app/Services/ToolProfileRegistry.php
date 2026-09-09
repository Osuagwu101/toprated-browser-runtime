<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use JsonException;

final class ToolProfileRegistry
{
    private const MAX_PROFILES = 100;
    private const MAX_POLICY_ITEMS = 20;

    private ?array $cachedProfiles = null;

    public function resolve(string $slug, string $writerId): array
    {
        $profiles = $this->profiles();
        if (! array_key_exists($slug, $profiles)) {
            throw new RuntimeApiException('TOOL_PROFILE_NOT_FOUND', 404, 'Configured tool profile not found.');
        }

        $profile = $profiles[$slug];
        if (($profile['enabled'] ?? false) !== true) {
            throw new RuntimeApiException('TOOL_PROFILE_DISABLED', 409, 'Configured tool profile is disabled.');
        }

        $launchUrl = str_replace('{writer_id}', rawurlencode($writerId), $profile['launch_url']);
        if (preg_match('/\{[A-Za-z0-9_]+\}/', $launchUrl)) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile contains an unsupported launch URL placeholder.');
        }
        $this->assertLaunchUrl($launchUrl);

        return [
            'slug' => $slug,
            'launchUrl' => $launchUrl,
            'browserState' => $profile['browser_state'],
            'authentication' => $profile['authentication'],
            'adminLoginUrl' => $profile['admin_login_url'],
        ];
    }

    public function summary(): array
    {
        $profiles = $this->profiles();
        $enabled = 0;
        $stateful = 0;
        $authenticationRequired = 0;
        foreach ($profiles as $profile) {
            if (($profile['enabled'] ?? false) === true) {
                $enabled++;
            }
            if (($profile['browser_state']['required'] ?? false) === true) {
                $stateful++;
            }
            if (($profile['authentication']['required'] ?? false) === true) {
                $authenticationRequired++;
            }
        }

        return [
            'configurationValid' => true,
            'configuredCount' => count($profiles),
            'enabledCount' => $enabled,
            'statefulCount' => $stateful,
            'authenticationRequiredCount' => $authenticationRequired,
        ];
    }

    private function profiles(): array
    {
        if ($this->cachedProfiles !== null) {
            return $this->cachedProfiles;
        }

        $path = trim((string) config('browser.tool_profiles_path', ''));
        if ($path === '' || ! is_file($path) || ! is_readable($path)) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile configuration file is unavailable.');
        }

        $raw = file_get_contents($path);
        if (! is_string($raw)) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile configuration could not be read.');
        }

        try {
            $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile configuration is not valid JSON.');
        }

        if (! is_array($decoded) || array_is_list($decoded) || count($decoded) < 1 || count($decoded) > self::MAX_PROFILES) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile configuration must contain between 1 and 100 named profiles.');
        }

        $validated = [];
        foreach ($decoded as $slug => $profile) {
            if (! is_string($slug) || strlen($slug) < 1 || strlen($slug) > 191 || ! preg_match('/^[A-Za-z0-9._-]+$/', $slug)) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile contains an invalid slug.');
            }
            if (! is_array($profile) || array_is_list($profile)) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile entries must be objects.');
            }
            $unexpected = array_diff(array_keys($profile), ['enabled', 'launch_url', 'admin_login_url', 'browser_state', 'authentication']);
            if ($unexpected !== []) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile contains unsupported fields.');
            }
            if (! array_key_exists('enabled', $profile) || ! is_bool($profile['enabled'])) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile enabled flag must be boolean.');
            }
            if (! is_string($profile['launch_url'] ?? null) || trim($profile['launch_url']) === '' || strlen($profile['launch_url']) > 8192) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile launch URL must be a bounded non-empty string.');
            }

            $template = trim($profile['launch_url']);
            $validationUrl = str_replace('{writer_id}', 'profile-validation-writer', $template);
            if (preg_match('/\{[A-Za-z0-9_]+\}/', $validationUrl)) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile contains an unsupported launch URL placeholder.');
            }
            $this->assertLaunchUrl($validationUrl);

            $adminLoginUrl = $profile['admin_login_url'] ?? $validationUrl;
            if (! is_string($adminLoginUrl) || trim($adminLoginUrl) === '' || strlen($adminLoginUrl) > 8192) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile administrator login URL must be a bounded non-empty string.');
            }
            $adminLoginUrl = trim($adminLoginUrl);
            if (str_contains($adminLoginUrl, '{writer_id}') || preg_match('/\{[A-Za-z0-9_]+\}/', $adminLoginUrl)) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile administrator login URL must not contain placeholders.');
            }
            $this->assertLaunchUrl($adminLoginUrl);

            $browserState = $this->validateBrowserStatePolicy($profile['browser_state'] ?? null, $validationUrl);
            $authentication = $this->validateAuthenticationPolicy($profile['authentication'] ?? null);
            if ($authentication['required'] && ! $browserState['required']) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Authenticated tool profiles must require authorized browser state.');
            }
            if ($authentication['required']) {
                $adminHost = strtolower((string) parse_url($adminLoginUrl, PHP_URL_HOST));
                $adminAllowed = false;
                foreach ($browserState['allowedHosts'] as $allowedHost) {
                    if ($this->hostMatches($adminHost, $allowedHost)) {
                        $adminAllowed = true;
                        break;
                    }
                }
                if (! $adminAllowed) {
                    throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Administrator login host is outside browser_state.allowed_hosts.');
                }
            }

            $validated[$slug] = [
                'enabled' => $profile['enabled'],
                'launch_url' => $template,
                'admin_login_url' => $adminLoginUrl,
                'browser_state' => $browserState,
                'authentication' => $authentication,
            ];
        }

        $this->cachedProfiles = $validated;

        return $validated;
    }

    private function validateBrowserStatePolicy(mixed $input, string $launchUrl): array
    {
        if ($input === null) {
            return ['required' => false, 'allowedHosts' => []];
        }
        if (! is_array($input) || array_is_list($input)) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile browser_state must be an object.');
        }
        $unexpected = array_diff(array_keys($input), ['required', 'allowed_hosts']);
        if ($unexpected !== []) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile browser_state contains unsupported fields.');
        }

        $required = $input['required'] ?? false;
        if (! is_bool($required)) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile browser_state.required must be boolean.');
        }
        $allowedHosts = $this->validateStringList($input['allowed_hosts'] ?? [], 'browser_state.allowed_hosts', 253, true);

        if ($required) {
            $scheme = strtolower((string) parse_url($launchUrl, PHP_URL_SCHEME));
            $host = strtolower((string) parse_url($launchUrl, PHP_URL_HOST));
            if (! in_array($scheme, ['http', 'https'], true) || $host === '' || $allowedHosts === []) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Stateful tool profiles require an HTTP(S) launch URL and allowed hosts.');
            }
            $launchAllowed = false;
            foreach ($allowedHosts as $allowedHost) {
                if ($this->hostMatches($host, $allowedHost)) {
                    $launchAllowed = true;
                    break;
                }
            }
            if (! $launchAllowed) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile launch host is outside browser_state.allowed_hosts.');
            }
        }

        return ['required' => $required, 'allowedHosts' => $allowedHosts];
    }

    private function validateAuthenticationPolicy(mixed $input): array
    {
        if ($input === null) {
            return [
                'required' => false,
                'urlContainsAny' => [],
                'selectorsAny' => [],
                'timeoutSeconds' => 10,
            ];
        }
        if (! is_array($input) || array_is_list($input)) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile authentication must be an object.');
        }
        $unexpected = array_diff(array_keys($input), ['required', 'url_contains_any', 'selectors_any', 'timeout_seconds']);
        if ($unexpected !== []) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile authentication contains unsupported fields.');
        }

        $required = $input['required'] ?? false;
        if (! is_bool($required)) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile authentication.required must be boolean.');
        }
        $urlContainsAny = $this->validateStringList($input['url_contains_any'] ?? [], 'authentication.url_contains_any', 512, false);
        $selectorsAny = $this->validateStringList($input['selectors_any'] ?? [], 'authentication.selectors_any', 512, false);
        $timeoutSeconds = $input['timeout_seconds'] ?? 10;
        if (! is_int($timeoutSeconds) || $timeoutSeconds < 1 || $timeoutSeconds > 30) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile authentication timeout must be between 1 and 30 seconds.');
        }
        if ($required && $urlContainsAny === [] && $selectorsAny === []) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Authenticated tool profiles require at least one authentication indicator.');
        }

        return [
            'required' => $required,
            'urlContainsAny' => $urlContainsAny,
            'selectorsAny' => $selectorsAny,
            'timeoutSeconds' => $timeoutSeconds,
        ];
    }

    private function validateStringList(mixed $input, string $field, int $maxLength, bool $hostList): array
    {
        if (! is_array($input) || ! array_is_list($input) || count($input) > self::MAX_POLICY_ITEMS) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, "Tool profile {$field} must be a bounded list.");
        }

        $validated = [];
        foreach ($input as $value) {
            if (! is_string($value)) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, "Tool profile {$field} contains an invalid value.");
            }
            $value = trim($value);
            if ($value === '' || strlen($value) > $maxLength) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, "Tool profile {$field} contains an invalid value.");
            }
            if ($hostList) {
                $value = strtolower(trim($value, '.'));
                if (filter_var($value, FILTER_VALIDATE_IP) === false
                    && ! preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/', $value)) {
                    throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, "Tool profile {$field} contains an invalid host.");
                }
            }
            $validated[$value] = true;
        }

        return array_keys($validated);
    }

    private function hostMatches(string $candidate, string $allowed): bool
    {
        $candidate = strtolower(trim($candidate, '.'));
        $allowed = strtolower(trim($allowed, '.'));

        return $candidate !== '' && $allowed !== ''
            && ($candidate === $allowed || str_ends_with($candidate, '.'.$allowed));
    }

    private function assertLaunchUrl(string $value): void
    {
        if (str_starts_with(strtolower($value), 'data:text/html')) {
            return;
        }
        if (filter_var($value, FILTER_VALIDATE_URL) === false) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile launch URL is invalid.');
        }
        if (! in_array(strtolower((string) parse_url($value, PHP_URL_SCHEME)), ['http', 'https'], true)) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile launch URL must use http, https, or data:text/html.');
        }
    }
}
