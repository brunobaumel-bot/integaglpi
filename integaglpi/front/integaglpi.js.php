<?php

declare(strict_types=1);

// JS asset proxy endpoint.
// Some environments return 404 when serving /plugins/.../js/*.js directly.
// We bootstrap GLPI to avoid server-specific 500s and to require an authenticated session.

try {
    include '../../../inc/includes.php';
    Session::checkLoginUser();

    $jsPath = dirname(__DIR__) . '/js/integaglpi.js';

    if (!is_file($jsPath)) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=UTF-8');
        header('Cache-Control: no-store');
        echo 'integaglpi.js not found';
        exit;
    }

    header('Content-Type: application/javascript; charset=UTF-8');
    header('Cache-Control: no-store');

    if (@readfile($jsPath) === false) {
        throw new RuntimeException('Failed to read integaglpi.js');
    }
    exit;
} catch (Throwable $e) {
    error_log('[integaglpi][assets][error] ' . $e->getMessage());
    error_log($e->getTraceAsString());
    http_response_code(500);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    echo 'integaglpi asset error';
    exit;
}

