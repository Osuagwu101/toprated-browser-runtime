<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use JsonException;

final class ToolProfileRegistry
{
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
        ];
    }

    public function summary(): array
    {
        $profiles = $this->profiles();
        $enabled = 0;
        foreach ($profiles as $profile) {
            if (($profile['enabled'] ?? false) === true) {
                $enabled++;
            }
        }

        return [
            'configurationValid' => true,
            'configuredCount' => count($profiles),
            'enabledCount' => $enabled,
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

        if (! is_array($decoded) || array_is_list($decoded) || count($decoded) < 1 || count($decoded) > 100) {
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
            $unexpected = array_diff(array_keys($profile), ['enabled', 'launch_url']);
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

            $validated[$slug] = [
                'enabled' => $profile['enabled'],
                'launch_url' => $template,
            ];
        }

        $this->cachedProfiles = $validated;

        return $validated;
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
