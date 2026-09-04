FROM php:8.4-cli-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl git unzip libonig-dev libsqlite3-dev \
    && docker-php-ext-install mbstring pdo_sqlite \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /srv/runtime-api
COPY api/composer.json ./composer.json
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader

COPY api/ ./
RUN mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views storage/logs storage/data bootstrap/cache \
    && touch storage/data/database.sqlite \
    && chmod -R 775 storage bootstrap/cache \
    && php artisan --version

EXPOSE 8080
CMD ["sh", "-lc", "php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=8080"]
