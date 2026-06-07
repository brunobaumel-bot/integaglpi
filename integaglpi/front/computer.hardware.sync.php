<?php

declare(strict_types=1);

/**
 * Internal bridge: Node → GLPI hardware enrichment.
 *
 * NOTE: This file is kept for reference but the actual web-accessible
 * entry point is public/integaglpi-hw-bridge.php (placed directly in
 * the LiteSpeed docroot to bypass GLPI's CSRF router for POST requests).
 *
 * PHASE: integaglpi_logmein_hardware_enrichment_php_bridge_001
 */

// Redirect callers to the correct public endpoint.
// This file should NOT be accessed directly via web (GLPI router intercepts it).
// The web-accessible entry point is /integaglpi-hw-bridge.php
http_response_code(404);
header('Content-Type: application/json; charset=UTF-8');
echo json_encode(['ok' => false, 'error' => 'use_public_endpoint']);
exit;
