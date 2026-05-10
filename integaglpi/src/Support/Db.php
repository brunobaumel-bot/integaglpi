<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Support;

final class Db
{
    public static function insert(string $table, array $input): bool
    {
        global $DB;

        $result = $DB->insert($table, $input);

        if ($result === false) {
            error_log('[integaglpi][db] insert failed on table=' . $table . ' error=' . $DB->error());
        }

        return $result !== false;
    }

    public static function update(string $table, array $input, array $where): bool
    {
        global $DB;

        $result = $DB->update($table, $input, $where);

        if ($result === false) {
            error_log('[integaglpi][db] update failed on table=' . $table . ' error=' . $DB->error());
        }

        return $result !== false;
    }

    public static function delete(string $table, array $where): bool
    {
        global $DB;

        $result = $DB->delete($table, $where);

        if ($result === false) {
            error_log('[integaglpi][db] delete failed on table=' . $table . ' error=' . $DB->error());
        }

        return $result !== false;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function fetchAll(array $criteria): array
    {
        global $DB;

        $rows = [];
        $iterator = $DB->request($criteria);

        foreach ($iterator as $row) {
            $rows[] = $row;
        }

        return $rows;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function fetchOne(array $criteria): ?array
    {
        $criteria['LIMIT'] = 1;
        $rows = self::fetchAll($criteria);

        return $rows[0] ?? null;
    }
}

