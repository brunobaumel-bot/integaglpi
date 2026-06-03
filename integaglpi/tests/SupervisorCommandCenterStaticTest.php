<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi\Tests;

use PHPUnit\Framework\TestCase;

final class SupervisorCommandCenterStaticTest extends TestCase
{
    private function pluginPath(string $relative): string
    {
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
    }

    private function read(string $relative): string
    {
        return (string) file_get_contents($this->pluginPath($relative));
    }

    public function testFilesExist(): void
    {
        self::assertFileExists($this->pluginPath('front/supervisor.command.php'));
        self::assertFileExists($this->pluginPath('src/Service/SupervisorCommandCenterService.php'));
        self::assertFileExists($this->pluginPath('templates/supervisor_command_center.php'));
    }

    public function testMenuChildRegisteredUnderSupervisao(): void
    {
        $menu = $this->read('src/SupervisaoGroupMenu.php');
        self::assertStringContainsString('command_center', $menu);
        self::assertStringContainsString('Dashboard Geral do Supervisor', $menu);
        self::assertStringContainsString('supervisor.command.php', $menu);
    }

    public function testFrontControllerRequiresSupervisorRead(): void
    {
        $front = $this->read('front/supervisor.command.php');
        self::assertStringContainsString('Session::checkLoginUser();', $front);
        self::assertStringContainsString('Session::checkRight(Plugin::RIGHT_NAME, READ);', $front);
        self::assertStringContainsString('Plugin::requireSupervisorRead();', $front);
        self::assertStringContainsString('SupervisaoGroupMenu::class', $front);
    }

    public function testServiceIsReadOnlyAndDelegatesToExistingServices(): void
    {
        $service = $this->read('src/Service/SupervisorCommandCenterService.php');
        foreach ([
            'SupervisorBackofficeService',
            'QualityDashboardService',
            'OnlineMonitorService',
            'AiOnlineAlertService',
            'TechnicalHealthDashboardService',
        ] as $expected) {
            self::assertStringContainsString($expected, $service);
        }

        $forbiddenTerms = [
            'send' . 'WhatsApp',
            'send' . 'Text' . 'Message',
            'create' . 'Ticket',
            'Ticket' . 'Task',
            'ITIL' . 'Followup',
            'sync' . 'Logmein',
        ];
        foreach ($forbiddenTerms as $forbidden) {
            self::assertStringNotContainsString($forbidden, $service);
        }
    }

    public function testTemplateHasNoMutationFormOrDangerousAction(): void
    {
        $template = $this->read('templates/supervisor_command_center.php');
        self::assertStringContainsString('method="get"', $template);
        self::assertStringNotContainsString('method="' . 'post"', $template);

        foreach (['Assumir', 'Transferir', 'Solucionar', 'Reabrir', 'Enviar WhatsApp'] as $forbidden) {
            self::assertStringNotContainsString($forbidden, $template);
        }
    }

    public function testOperationalManagementBlocksArePresent(): void
    {
        $template = $this->read('templates/supervisor_command_center.php');
        self::assertStringContainsString('Ações do Supervisor — Prioridade agora', $template);
        self::assertStringContainsString('Gestão da equipe', $template);
        self::assertStringContainsString('Clientes/Entidades em atenção', $template);
        self::assertStringContainsString('Qualidade e IA', $template);
        self::assertStringContainsString('Rodapé técnico compacto', $template);
        self::assertStringNotContainsString('Status das Integrações', $template);
    }

    public function testDashboardConsumesOpenAiAlertsAsSupervisorPriorities(): void
    {
        $service = $this->read('src/Service/SupervisorCommandCenterService.php');
        $alertService = $this->read('src/Service/AiOnlineAlertService.php');
        $template = $this->read('templates/supervisor_command_center.php');

        self::assertStringContainsString('getSupervisorSummary', $service);
        self::assertStringContainsString('high_open_count', $service);
        self::assertStringContainsString('open_count', $service);
        self::assertStringContainsString('buildAiAlertAction', $service);
        self::assertStringContainsString('possible_frustration', $service);
        self::assertStringContainsString('supervisor_requested', $service);
        self::assertStringContainsString('long_inactivity_risk', $service);
        self::assertStringContainsString('Monitor Online / Detalhes', $service);
        self::assertStringContainsString('evidence_summary_sanitized', $service);
        self::assertStringContainsString('getSupervisorSummary', $alertService);
        self::assertStringContainsString('glpi_plugin_integaglpi_ai_online_alerts', $alertService);
        self::assertStringContainsString('COUNT(*)::int', $alertService);
        self::assertStringContainsString('LIMIT :limit', $alertService);
        self::assertStringContainsString('dismissed_until IS NULL', $alertService);
        self::assertStringContainsString('$row[\'evidence\']', $template);
        self::assertStringContainsString('$row[\'monitor_url\']', $template);
        self::assertStringContainsString('Alertas IA abertos', $template);
    }

    public function testServiceBuildsOperationalSections(): void
    {
        $service = $this->read('src/Service/SupervisorCommandCenterService.php');
        foreach ([
            'team_management',
            'client_entity_risk',
            'quality_ai',
            'technical_footer',
            'buildTeamManagement',
            'buildClientEntityRisk',
            'buildQualityAi',
        ] as $expected) {
            self::assertStringContainsString($expected, $service);
        }
    }

    public function testNoPunitiveLanguage(): void
    {
        $template = $this->read('templates/supervisor_command_center.php');
        $service = $this->read('src/Service/SupervisorCommandCenterService.php');
        foreach (['ran' . 'king', 'leader' . 'board', 'produtivi' . 'dade', 'melhor ' . 'técnico', 'pior ' . 'técnico'] as $forbidden) {
            self::assertStringNotContainsString($forbidden, $template);
            self::assertStringNotContainsString($forbidden, $service);
        }
    }

    public function testPiiGuardAndDrilldownsArePresent(): void
    {
        $template = $this->read('templates/supervisor_command_center.php');
        self::assertStringContainsString('PII Guard ativo', $template);
        self::assertStringContainsString('payload bruto', $template);
        self::assertStringContainsString('getSupervisorBackofficeUrl()', $template);
        self::assertStringContainsString('getQualityDashboardUrl()', $template);
        self::assertStringContainsString('getOnlineMonitorUrl()', $template);
        self::assertStringContainsString('getTechnicalHealthUrl()', $template);
    }

    public function testLogmeinReconciliationIsDisplayedAsOff(): void
    {
        $service = $this->read('src/Service/SupervisorCommandCenterService.php');
        self::assertStringContainsString('logmein_reconciliation', $service);
        self::assertStringContainsString("'status' => 'off'", $service);
        self::assertStringContainsString('Sem botão de sync', $service);
    }
}
