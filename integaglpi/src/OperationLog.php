<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;

final class OperationLog extends CommonDBTM
{
    public static $rightname = Plugin::RIGHT_NAME;

    public static function getTypeName($nb = 0): string
    {
        return _n('WhatsApp operation log', 'WhatsApp operation logs', $nb, 'glpiintegaglpi');
    }
}

