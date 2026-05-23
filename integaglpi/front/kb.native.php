<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Renderer\NativeKnowledgeBaseRenderer;
use GlpiPlugin\Integaglpi\Service\NativeKnowledgeBaseService;

include '../../../inc/includes.php';

Session::checkLoginUser();
Plugin::requireKnowledgeBaseRead();

Html::header(__('Base de Conhecimento GLPI', 'glpiintegaglpi'), $_SERVER['PHP_SELF'], 'plugins');

$renderer = new NativeKnowledgeBaseRenderer(new NativeKnowledgeBaseService());
$renderer->render($_GET);

Html::footer();
