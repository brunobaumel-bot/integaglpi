<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Service;

use Computer;
use DeviceProcessor;
use DeviceMemory;
use Item_DeviceProcessor;
use Item_DeviceMemory;
use NetworkPort;
use NetworkPortEthernet;
use Throwable;

/**
 * Writes LogMeIn Hardware Inventory data into GLPI using native PHP/GLPI classes.
 *
 * Rules:
 *  - Idempotent: the same payload must not duplicate components.
 *  - Manufacturer/model: look up by name; create only if safe via native class.
 *  - Serial: only write if Computer.serial is currently empty OR already set by LogMeIn.
 *  - Comment: preserve manual content; only update block marked [IntegraGLPI LogMeIn Hardware Sync].
 *  - Processors/memory/network: idempotent via origin marker in comment/name.
 *  - Never writes to tickets, entities, users, contracts or KB.
 *  - Never invents data: null/missing fields are left unchanged.
 *  - PII guard: localUsers, windowsProfiles, lastLogonUserName are ignored by the caller;
 *    this service also verifies and ignores them if present.
 *
 * PHASE: integaglpi_logmein_hardware_enrichment_php_bridge_001
 */
final class ComputerHardwareSyncService
{
    private const LOGMEIN_SYNC_MARKER = '[IntegraGLPI LogMeIn Hardware Sync]';

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function sync(int $computerId, array $input): array
    {
        $computer = new Computer();
        if (!$computer->getFromDB($computerId)) {
            return ['status' => 'not_found', 'computer_id' => $computerId];
        }

        $results = [
            'computer_id' => $computerId,
            'serial'      => 'skipped',
            'comment'     => 'skipped',
            'manufacturer'=> 'skipped',
            'model'       => 'skipped',
            'processor'   => 'skipped',
            'memory'      => 'skipped',
            'network_mac' => 'skipped',
        ];

        // ── Serial / service_tag ────────────────────────────────────────────────
        $serviceTag = $this->safeText($input['service_tag'] ?? null, 255);
        if ($serviceTag !== null) {
            $currentSerial = trim((string) ($computer->fields['serial'] ?? ''));
            $isLogMeInSerial = str_contains((string) ($computer->fields['comment'] ?? ''), self::LOGMEIN_SYNC_MARKER);
            if ($currentSerial === '' || $isLogMeInSerial) {
                $computer->update(['id' => $computerId, 'serial' => $serviceTag]);
                $results['serial'] = 'updated';
            } else {
                $results['serial'] = 'conflict_preserved';
            }
        }

        // ── Manufacturer ────────────────────────────────────────────────────────
        $manufacturerName = $this->safeText($input['manufacturer'] ?? null, 120);
        if ($manufacturerName !== null) {
            try {
                $manufacturerId = $this->findOrCreateManufacturer($manufacturerName);
                if ($manufacturerId > 0 && ($computer->fields['manufacturers_id'] ?? 0) != $manufacturerId) {
                    $computer->update(['id' => $computerId, 'manufacturers_id' => $manufacturerId]);
                    $results['manufacturer'] = 'updated';
                } elseif ($manufacturerId > 0) {
                    $results['manufacturer'] = 'already_set';
                } else {
                    $results['manufacturer'] = 'lookup_failed';
                }
            } catch (Throwable $e) {
                error_log('[integaglpi][hw_sync][manufacturer] ' . mb_substr(strip_tags($e->getMessage()), 0, 160));
                $results['manufacturer'] = 'error';
            }
        }

        // ── Model ───────────────────────────────────────────────────────────────
        $modelName = $this->safeText($input['model'] ?? null, 120);
        if ($modelName !== null) {
            try {
                $modelId = $this->findOrCreateComputerModel($modelName);
                if ($modelId > 0 && ($computer->fields['computermodels_id'] ?? 0) != $modelId) {
                    $computer->update(['id' => $computerId, 'computermodels_id' => $modelId]);
                    $results['model'] = 'updated';
                } elseif ($modelId > 0) {
                    $results['model'] = 'already_set';
                } else {
                    $results['model'] = 'lookup_failed';
                }
            } catch (Throwable $e) {
                error_log('[integaglpi][hw_sync][model] ' . mb_substr(strip_tags($e->getMessage()), 0, 160));
                $results['model'] = 'error';
            }
        }

        // ── Comment block ────────────────────────────────────────────────────────
        $commentLines = [];
        if ($manufacturerName !== null) {
            $commentLines[] = 'Fabricante: ' . $manufacturerName;
        }
        if ($modelName !== null) {
            $commentLines[] = 'Modelo: ' . $modelName;
        }
        $memMb = is_int($input['memory_mb'] ?? null) && ($input['memory_mb'] ?? 0) > 0
            ? (int) $input['memory_mb'] : null;
        if ($memMb !== null) {
            $commentLines[] = 'RAM: ' . $memMb . ' MB';
        }
        if (!empty($input['processors']) && is_array($input['processors'])) {
            $p = $input['processors'][0] ?? [];
            $cpuType = $this->safeText($p['type'] ?? null, 80);
            if ($cpuType !== null) {
                $cores = is_int($p['number_of_cores'] ?? null) ? (int) $p['number_of_cores'] : null;
                $speed = is_int($p['speed_mhz'] ?? null) ? (int) $p['speed_mhz'] : null;
                $commentLines[] = 'CPU: ' . $cpuType
                    . ($cores ? ' (' . $cores . ' cores)' : '')
                    . ($speed ? ' @ ' . $speed . 'MHz' : '');
            }
        }

        if ($commentLines !== []) {
            $newBlock = self::LOGMEIN_SYNC_MARKER . "\n" . implode("\n", $commentLines);
            $existingComment = (string) ($computer->fields['comment'] ?? '');
            $updatedComment  = $this->replaceOrAppendLogMeInBlock($existingComment, $newBlock);
            if ($updatedComment !== $existingComment) {
                $computer->update(['id' => $computerId, 'comment' => $updatedComment]);
                $results['comment'] = 'updated';
            } else {
                $results['comment'] = 'unchanged';
            }
        }

        // ── Processor ────────────────────────────────────────────────────────────
        if (!empty($input['processors']) && is_array($input['processors'])) {
            $results['processor'] = $this->syncProcessors($computerId, $input['processors']);
        }

        // ── Memory ───────────────────────────────────────────────────────────────
        if ($memMb !== null) {
            $results['memory'] = $this->syncMemory($computerId, $memMb);
        }

        // ── Network / MAC ─────────────────────────────────────────────────────────
        if (!empty($input['network_connections']) && is_array($input['network_connections'])) {
            $results['network_mac'] = $this->syncNetworkMac($computerId, $input['network_connections']);
        }

        $results['status'] = 'ok';
        return $results;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private function replaceOrAppendLogMeInBlock(string $existing, string $newBlock): string
    {
        $pattern = '/' . preg_quote(self::LOGMEIN_SYNC_MARKER, '/') . '.*?(?=\n\[|\z)/s';
        if (preg_match($pattern, $existing)) {
            return trim((string) preg_replace($pattern, $newBlock, $existing));
        }

        return $existing !== '' ? $existing . "\n\n" . $newBlock : $newBlock;
    }

    private function findOrCreateManufacturer(string $name): int
    {
        global $DB;
        $table = 'glpi_manufacturers';
        if (!$DB->tableExists($table)) {
            return 0;
        }
        $res = $DB->request(['SELECT' => ['id'], 'FROM' => $table, 'WHERE' => ['name' => $name], 'LIMIT' => 1]);
        foreach ($res as $row) {
            return (int) $row['id'];
        }
        // Create — safe because Manufacturer is a dropdown, no tickets/entities/users touched.
        $obj = new \Manufacturer();
        $id  = $obj->add(['name' => $name]);
        return $id > 0 ? (int) $id : 0;
    }

    private function findOrCreateComputerModel(string $name): int
    {
        global $DB;
        $table = 'glpi_computermodels';
        if (!$DB->tableExists($table)) {
            return 0;
        }
        $res = $DB->request(['SELECT' => ['id'], 'FROM' => $table, 'WHERE' => ['name' => $name], 'LIMIT' => 1]);
        foreach ($res as $row) {
            return (int) $row['id'];
        }
        $obj = new \ComputerModel();
        $id  = $obj->add(['name' => $name]);
        return $id > 0 ? (int) $id : 0;
    }

    /**
     * @param array<int, array<string, mixed>> $processors
     * @return string
     */
    private function syncProcessors(int $computerId, array $processors): string
    {
        if (!class_exists('DeviceProcessor') || !class_exists('Item_DeviceProcessor')) {
            return 'class_unavailable';
        }

        $updated = 0;
        foreach ($processors as $p) {
            $cpuType = $this->safeText($p['type'] ?? null, 200);
            if ($cpuType === null) {
                continue;
            }
            $speed   = is_int($p['speed_mhz'] ?? null) ? (int) $p['speed_mhz'] : 0;
            $cores   = is_int($p['number_of_cores'] ?? null) ? (int) $p['number_of_cores'] : 0;

            // Idempotency: check if already linked by matching CPU type + computer.
            $alreadyLinked = $this->isCpuAlreadyLinked($computerId, $cpuType);
            if ($alreadyLinked) {
                continue;
            }

            // Find or create DeviceProcessor.
            $dpId = $this->findOrCreateDeviceProcessor($cpuType, $speed, $cores);
            if ($dpId <= 0) {
                continue;
            }

            $link = new Item_DeviceProcessor();
            $link->add([
                'items_id'          => $computerId,
                'itemtype'          => 'Computer',
                'deviceprocessors_id' => $dpId,
                'nbcores_device'    => $cores > 0 ? $cores : null,
                'frequency'         => $speed > 0 ? $speed : null,
            ]);
            $updated++;
        }

        return $updated > 0 ? 'updated:' . $updated : 'already_present';
    }

    private function isCpuAlreadyLinked(int $computerId, string $cpuType): bool
    {
        global $DB;
        if (!$DB->tableExists('glpi_items_deviceprocessors') || !$DB->tableExists('glpi_deviceprocessors')) {
            return false;
        }
        $res = $DB->request([
            'SELECT' => ['idp.id'],
            'FROM'   => 'glpi_items_deviceprocessors AS idp',
            'JOIN'   => [[
                'TABLE'  => 'glpi_deviceprocessors AS dp',
                'FKEY'   => ['idp' => 'deviceprocessors_id', 'dp' => 'id'],
            ]],
            'WHERE'  => ['idp.items_id' => $computerId, 'idp.itemtype' => 'Computer', 'dp.designation' => $cpuType],
            'LIMIT'  => 1,
        ]);
        return count(iterator_to_array($res)) > 0;
    }

    private function findOrCreateDeviceProcessor(string $cpuType, int $speed, int $cores): int
    {
        global $DB;
        $res = $DB->request([
            'SELECT' => ['id'],
            'FROM'   => 'glpi_deviceprocessors',
            'WHERE'  => ['designation' => $cpuType],
            'LIMIT'  => 1,
        ]);
        foreach ($res as $row) {
            return (int) $row['id'];
        }
        $dp = new DeviceProcessor();
        $id = $dp->add([
            'designation' => $cpuType,
            'frequence'   => $speed > 0 ? $speed : null,
            'nbcores_default' => $cores > 0 ? $cores : null,
        ]);
        return $id > 0 ? (int) $id : 0;
    }

    private function syncMemory(int $computerId, int $totalMb): string
    {
        if (!class_exists('DeviceMemory') || !class_exists('Item_DeviceMemory')) {
            return 'class_unavailable';
        }

        // Idempotency: check if a LogMeIn-origin memory item already linked.
        global $DB;
        $label = 'LogMeIn ' . $totalMb . ' MB';
        if ($DB->tableExists('glpi_items_devicememories') && $DB->tableExists('glpi_devicememories')) {
            $res = $DB->request([
                'SELECT' => ['idm.id'],
                'FROM'   => 'glpi_items_devicememories AS idm',
                'JOIN'   => [[
                    'TABLE' => 'glpi_devicememories AS dm',
                    'FKEY'  => ['idm' => 'devicememories_id', 'dm' => 'id'],
                ]],
                'WHERE'  => ['idm.items_id' => $computerId, 'idm.itemtype' => 'Computer', 'dm.designation' => $label],
                'LIMIT'  => 1,
            ]);
            if (count(iterator_to_array($res)) > 0) {
                return 'already_present';
            }
        }

        $dm   = new DeviceMemory();
        $dmId = $dm->add(['designation' => $label, 'size_default' => $totalMb]);
        if ($dmId <= 0) {
            return 'create_failed';
        }

        $link = new Item_DeviceMemory();
        $link->add([
            'items_id'       => $computerId,
            'itemtype'       => 'Computer',
            'devicememories_id' => $dmId,
            'size'           => $totalMb,
        ]);
        return 'updated';
    }

    /**
     * @param array<int, array<string, mixed>> $connections
     */
    private function syncNetworkMac(int $computerId, array $connections): string
    {
        if (!class_exists('NetworkPort') || !class_exists('NetworkPortEthernet')) {
            return 'class_unavailable';
        }

        $updated = 0;
        foreach ($connections as $conn) {
            $mac  = $this->safeText($conn['mac_address'] ?? null, 20);
            $name = $this->safeText($conn['name'] ?? null, 200) ?? 'LogMeIn Network';
            if ($mac === null) {
                continue;
            }

            // Idempotency: skip if MAC already linked.
            if ($this->isMacAlreadyLinked($computerId, $mac)) {
                continue;
            }

            $np = new NetworkPort();
            $npId = $np->add([
                'items_id'         => $computerId,
                'itemtype'         => 'Computer',
                'instantiation_type' => 'NetworkPortEthernet',
                'name'             => $name,
                'mac'              => $mac,
            ]);

            if ($npId > 0) {
                $eth = new NetworkPortEthernet();
                $eth->add(['networkports_id' => $npId]);
                $updated++;
            }
        }

        return $updated > 0 ? 'updated:' . $updated : 'already_present';
    }

    private function isMacAlreadyLinked(int $computerId, string $mac): bool
    {
        global $DB;
        if (!$DB->tableExists('glpi_networkports')) {
            return false;
        }
        $res = $DB->request([
            'SELECT' => ['id'],
            'FROM'   => 'glpi_networkports',
            'WHERE'  => ['items_id' => $computerId, 'itemtype' => 'Computer', 'mac' => $mac],
            'LIMIT'  => 1,
        ]);
        return count(iterator_to_array($res)) > 0;
    }

    private function safeText(mixed $value, int $max): ?string
    {
        if (!is_scalar($value)) {
            return null;
        }
        $s = trim((string) $value);
        return $s !== '' ? mb_substr($s, 0, $max, 'UTF-8') : null;
    }
}
