<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonGLPI;
use GlpiPlugin\Integaglpi\Renderer\TicketTabRenderer;
use GlpiPlugin\Integaglpi\Service\TicketRuntimeService;
use Session;

class TicketRuntime extends CommonGLPI
{
    public static $rightname = '';

    public static function getTypeName($nb = 0): string
    {
        return _n('WhatsApp runtime', 'WhatsApp runtimes', $nb, 'glpiintegaglpi');
    }

    public function getTabNameForItem(CommonGLPI $item, $withtemplate = 0): string
    {
        error_log('[integaglpi][tabs] getTabNameForItem called');

        if (!$item instanceof \Ticket || $item->isNewItem()) {
            return '';
        }

        return 'WhatsApp';
    }

    public static function displayTabContentForItem(CommonGLPI $item, $tabnum = 1, $withtemplate = 0): bool
    {
        error_log('[integaglpi][tabs] displayTabContentForItem called');

        if (!$item instanceof \Ticket) {
            return false;
        }

        (new TicketTabRenderer(new TicketRuntimeService()))->render($item);

        return true;
    }
}
