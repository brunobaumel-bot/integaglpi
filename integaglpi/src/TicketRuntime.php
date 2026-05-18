<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonGLPI;
use GlpiPlugin\Integaglpi\Renderer\TicketTabRenderer;
use GlpiPlugin\Integaglpi\Service\TicketContextService;
use GlpiPlugin\Integaglpi\Service\TicketRuntimeService;
use Session;

class TicketRuntime extends CommonGLPI
{
    public static $rightname = '';

    public static function getTypeName($nb = 0): string
    {
        return _n('WhatsApp runtime', 'WhatsApp runtimes', $nb, 'glpiintegaglpi');
    }

    public function getTabNameForItem(CommonGLPI $item, $withtemplate = 0)
    {
        if (!$item instanceof \Ticket || $item->isNewItem()) {
            return '';
        }

        if (!\Session::haveRight(Plugin::RIGHT_NAME, READ)) {
            return '';
        }

        return [
            1 => __('Conversas WhatsApp', 'glpiintegaglpi'),
            2 => __('Contexto WhatsApp', 'glpiintegaglpi'),
        ];
    }

    public static function displayTabContentForItem(CommonGLPI $item, $tabnum = 1, $withtemplate = 0): bool
    {
        if (!$item instanceof \Ticket) {
            return false;
        }

        if (!\Session::haveRight(Plugin::RIGHT_NAME, READ)) {
            return false;
        }

        $view = ((int) $tabnum) === 2 ? 'context' : 'conversations';
        (new TicketTabRenderer(new TicketRuntimeService(), new TicketContextService()))->render($item, $view);

        return true;
    }
}
