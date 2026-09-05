<?php

namespace App\Services;

use App\Exceptions\RuntimeApiException;
use JsonException;

final class AuthorizedBrowserState
{
    private const MAX_COOKIES = 200;
    private const MAX_STORAGE_ENTRIES = 512;
    private const MAX_COOKIE_NAME_BYTES = 256;
    private const MAX_COOKIE_VALUE_BYTES = 16384;
    private const MAX_STORAGE_KEY_BYTES = 1024;
    private const MAX_STORAGE_VALUE_BYTES = 32768;

    public function configuration(): array
    {
        $maxBytes = (int) config('browser.browser_state_max_bytes', 262144);
        if ($maxBytes < 4096 || $maxBytes > 1048576) {
            throw new RuntimeApiException('BROWSER_STATE_CONFIG_INVALID', 503, 'Authorized browser-state size configuration is invalid.');
        }

        return ['maxBytes' => $maxBytes];
    }

    public function normalize(mixed $input, array $policy, string $launchUrl): ?array
    {
        if ($input === null) {
            return null;
        }
        if (! is_array($input) || array_is_list($input)) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser state must be a JSON object.');
        }

        $configuration = $this->configuration();
        try {
            $encoded = json_encode($input, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (JsonException) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser state is not valid JSON data.');
        }
        if (! is_string($encoded) || strlen($encoded) > $configuration['maxBytes']) {
            throw new RuntimeApiException('BROWSER_STATE_TOO_LARGE', 413, 'Authorized browser state exceeds the configured size limit.');
        }

        $unexpected = array_diff(array_keys($input), ['authenticated_cookies', 'session_tokens', 'auth_headers']);
        if ($unexpected !== []) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser state contains unsupported fields.');
        }

        $allowedHosts = $this->allowedHosts($policy, $launchUrl);
        $cookies = $this->normalizeCookies($input['authenticated_cookies'] ?? [], $allowedHosts);
        $storage = $this->normalizeStorage($input['session_tokens'] ?? []);

        $authHeaders = $input['auth_headers'] ?? [];
        if (! is_array($authHeaders) || $authHeaders !== []) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Phase 8 does not accept reusable authentication headers.');
        }

        if ($cookies === [] && $storage['localStorage'] === [] && $storage['sessionStorage'] === []) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser state does not contain reusable cookies or browser storage.');
        }

        return [
            'cookies' => $cookies,
            'storage' => $storage,
        ];
    }

    private function allowedHosts(array $policy, string $launchUrl): array
    {
        $configured = $policy['allowedHosts'] ?? [];
        if (! is_array($configured) || array_is_list($configured) === false && $configured !== []) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile browser-state host policy is invalid.');
        }

        $launchHost = strtolower(trim((string) parse_url($launchUrl, PHP_URL_HOST)));
        $hosts = [];
        foreach ($configured as $host) {
            if (! is_string($host)) {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile browser-state host policy is invalid.');
            }
            $normalized = $this->normalizeHost($host);
            if ($normalized === '') {
                throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile browser-state host policy is invalid.');
            }
            $hosts[$normalized] = true;
        }

        if ($hosts === [] && $launchHost !== '') {
            $hosts[$this->normalizeHost($launchHost)] = true;
        }
        if ($hosts === []) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Stateful tool profiles require an HTTP(S) launch host.');
        }

        $launchAllowed = false;
        foreach (array_keys($hosts) as $host) {
            if ($this->hostMatches($launchHost, $host)) {
                $launchAllowed = true;
                break;
            }
        }
        if (! $launchAllowed) {
            throw new RuntimeApiException('TOOL_PROFILE_CONFIG_INVALID', 503, 'Tool profile launch host is outside its browser-state host policy.');
        }

        return array_keys($hosts);
    }

    private function normalizeCookies(mixed $input, array $allowedHosts): array
    {
        if ($input === null) {
            return [];
        }
        if (! is_array($input) || ! array_is_list($input) || count($input) > self::MAX_COOKIES) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookies must be a bounded JSON array.');
        }

        $cookies = [];
        foreach ($input as $cookie) {
            if (! is_array($cookie) || array_is_list($cookie)) {
                throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie entries must be JSON objects.');
            }
            $unexpected = array_diff(array_keys($cookie), ['name', 'value', 'domain', 'path', 'expires', 'secure', 'httpOnly', 'sameSite']);
            if ($unexpected !== []) {
                throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie entry contains unsupported fields.');
            }

            $name = $cookie['name'] ?? null;
            $value = $cookie['value'] ?? null;
            if (! is_string($name) || $name === '' || strlen($name) > self::MAX_COOKIE_NAME_BYTES || preg_match('/[\x00-\x20\x7f;,=]/', $name)) {
                throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid name.');
            }
            if (! is_string($value) || strlen($value) > self::MAX_COOKIE_VALUE_BYTES) {
                throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid value.');
            }

            $normalized = ['name' => $name, 'value' => $value];
            $domain = $cookie['domain'] ?? null;
            if ($domain !== null && $domain !== '') {
                if (! is_string($domain) || strlen($domain) > 253) {
                    throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid domain.');
                }
                $normalizedDomain = $this->normalizeHost($domain);
                $allowed = false;
                foreach ($allowedHosts as $host) {
                    if ($this->hostMatches($normalizedDomain, $host) || $this->hostMatches($host, $normalizedDomain)) {
                        $allowed = true;
                        break;
                    }
                }
                if (! $allowed) {
                    throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie domain is outside the configured tool hosts.');
                }
                $normalized['domain'] = $normalizedDomain;
            }

            $path = $cookie['path'] ?? '/';
            if (! is_string($path) || $path === '' || ! str_starts_with($path, '/') || strlen($path) > 2048) {
                throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid path.');
            }
            $normalized['path'] = $path;

            if (array_key_exists('expires', $cookie) && $cookie['expires'] !== null) {
                if (! is_int($cookie['expires']) && ! is_float($cookie['expires'])) {
                    throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid expiry.');
                }
                $expires = (float) $cookie['expires'];
                if (! is_finite($expires) || $expires < -1 || $expires > 32503680000) {
                    throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid expiry.');
                }
                $normalized['expires'] = $expires;
            }

            foreach (['secure', 'httpOnly'] as $flag) {
                if (array_key_exists($flag, $cookie)) {
                    if (! is_bool($cookie[$flag])) {
                        throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid security flag.');
                    }
                    $normalized[$flag] = $cookie[$flag];
                }
            }

            if (array_key_exists('sameSite', $cookie) && $cookie['sameSite'] !== null && $cookie['sameSite'] !== '') {
                if (! is_string($cookie['sameSite'])) {
                    throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid SameSite value.');
                }
                $sameSite = ucfirst(strtolower($cookie['sameSite']));
                if (! in_array($sameSite, ['Strict', 'Lax', 'None'], true)) {
                    throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized cookie contains an invalid SameSite value.');
                }
                $normalized['sameSite'] = $sameSite;
            }

            $cookies[] = $normalized;
        }

        return $cookies;
    }

    private function normalizeStorage(mixed $sessionTokens): array
    {
        if ($sessionTokens === null) {
            $sessionTokens = [];
        }
        if (! is_array($sessionTokens) || array_is_list($sessionTokens)) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized session token state must be a JSON object.');
        }

        $unexpected = array_diff(array_keys($sessionTokens), ['captured_at', 'storage']);
        if ($unexpected !== []) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Phase 8 accepts browser Web Storage only; reusable token fields are not accepted directly.');
        }

        if (array_key_exists('captured_at', $sessionTokens) && $sessionTokens['captured_at'] !== null && ! is_string($sessionTokens['captured_at'])) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser-state capture metadata is invalid.');
        }

        $storage = $sessionTokens['storage'] ?? [];
        if (! is_array($storage) || array_is_list($storage)) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser storage must be a JSON object.');
        }
        $unexpectedStorage = array_diff(array_keys($storage), ['localStorage', 'sessionStorage']);
        if ($unexpectedStorage !== []) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser storage contains unsupported fields.');
        }

        $local = $this->normalizeStorageMap($storage['localStorage'] ?? []);
        $session = $this->normalizeStorageMap($storage['sessionStorage'] ?? []);
        if (count($local) + count($session) > self::MAX_STORAGE_ENTRIES) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser storage contains too many entries.');
        }

        return ['localStorage' => $local, 'sessionStorage' => $session];
    }

    private function normalizeStorageMap(mixed $input): array
    {
        if ($input === null) {
            return [];
        }
        if (! is_array($input) || array_is_list($input)) {
            throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser storage namespace must be a JSON object.');
        }

        $normalized = [];
        foreach ($input as $key => $value) {
            if (! is_string($key) || $key === '' || strlen($key) > self::MAX_STORAGE_KEY_BYTES || ! is_string($value) || strlen($value) > self::MAX_STORAGE_VALUE_BYTES) {
                throw new RuntimeApiException('BROWSER_STATE_INVALID', 422, 'Authorized browser storage contains an invalid key or value.');
            }
            $normalized[$key] = $value;
        }

        return $normalized;
    }

    private function normalizeHost(string $value): string
    {
        $host = strtolower(trim($value));
        $host = trim($host, '.');
        if ($host === '') {
            return '';
        }
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return $host;
        }
        if (strlen($host) > 253 || ! preg_match('/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/', $host)) {
            return '';
        }

        return $host;
    }

    private function hostMatches(string $candidate, string $allowed): bool
    {
        if ($candidate === '' || $allowed === '') {
            return false;
        }

        return $candidate === $allowed || str_ends_with($candidate, '.'.$allowed);
    }
}
