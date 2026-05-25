<?php

declare(strict_types=1);

include '../../../inc/includes.php';

use GlpiPlugin\Integaglpi\AiOperationsMenu;
use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\AiOperationsRenderer;
use GlpiPlugin\Integaglpi\Service\AiOperationsService;

Session::checkLoginUser();
Plugin::requireAiOperationsRead();

Html::header(__('IA & Conhecimento', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins', AiOperationsMenu::class);

$renderer = new AiOperationsRenderer();
$renderer->render((new AiOperationsService())->getHubData());

Html::footer();
