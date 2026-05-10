<?php

declare(strict_types=1);

namespace GlpiPlugin\Integaglpi;

use CommonDBTM;
use CommonGLPI;
use Profile as GlpiProfile;
use ProfileRight;
use Session;

final class Profile extends CommonDBTM
{
    public static $rightname = 'profile';

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function getAllRights(): array
    {
        return [
            [
                'field' => Plugin::RIGHT_NAME,
                'name'  => __('Plugin Integaglpi', 'integaglpi'),
                'rights' => [
                    READ   => __('Read'),
                    UPDATE => __('Update'),
                ],
                'default' => READ,
            ],
        ];
    }

    public static function getTypeName($nb = 0): string
    {
        return __('PluginIntegaglpi', 'glpiintegaglpi');
    }

    public function getTabNameForItem(CommonGLPI $item, $withtemplate = 0): string
    {
        if ($item instanceof GlpiProfile && (int) $item->getID() > 0) {
            return self::createTabEntry(self::getTypeName());
        }

        return '';
    }

    public static function displayTabContentForItem(CommonGLPI $item, $tabnum = 1, $withtemplate = 0): bool
    {
        if (!$item instanceof GlpiProfile) {
            return false;
        }

        self::showRightsForm($item);

        return true;
    }

    public static function saveProfileRights(int $profileId, int $rightsValue): void
    {
        self::ensureCanonicalRightRegistered();

        ProfileRight::updateProfileRights($profileId, [
            Plugin::RIGHT_NAME => $rightsValue,
        ]);
    }

    private static function showRightsForm(GlpiProfile $profile): void
    {
        $profileId = (int) $profile->getID();
        $profileName = (string) ($profile->fields['name'] ?? '');

        // TEMP DIAGNOSTIC: confirm which profile is being rendered in the tab
        // and which ID will be embedded in the Edit link. Remove once root
        // cause of wrong-profile reports is confirmed.
        error_log(sprintf(
            '[integaglpi][Profile.tab] render tab profileId=%d name=%s for activeUser=%s activeProfile=%s',
            $profileId,
            var_export($profileName, true),
            var_export(Session::getLoginUserID(), true),
            var_export($_SESSION['glpiactiveprofile']['id'] ?? null, true)
        ));

        $rightFields = [
            Plugin::RIGHT_NAME,
            'PluginIntegaglpi',
            'PluginWhatsapp',
        ];
        $currentRights = ProfileRight::getProfileRights($profileId, $rightFields);
        $rightValue = self::resolveDisplayedRightValue($currentRights);
        $actionUrl = Plugin::getWebBasePath() . '/front/profile.form.php';
        // Send both parameter names so any GLPI hook reading either one resolves
        // to the same profile. The plugin's profile.form.php prefers profiles_id.
        $editUrl = $actionUrl . '?profiles_id=' . $profileId . '&id=' . $profileId;
        $safeEditUrl = self::escapeAttribute($editUrl);

        error_log(sprintf(
            '[integaglpi][Profile.tab] edit link href=%s',
            $editUrl
        ));

        echo "<div class='card glpiintegaglpi-profile-rights'>";
        echo "<div class='card-header'>" . self::getTypeName() . '</div>';
        echo "<div class='card-body'>";
        echo "<p class='mb-3'>" . __('Control access to the WhatsApp operational tab and actions.', 'integaglpi') . '</p>';
        echo "<p class='mb-3'>"
            . __('Read') . ': <strong>' . (($rightValue & READ) !== 0 ? __('Yes') : __('No')) . '</strong><br>'
            . __('Update') . ': <strong>' . (($rightValue & UPDATE) !== 0 ? __('Yes') : __('No')) . '</strong>'
            . '</p>';

        if (Session::haveRight(self::$rightname, UPDATE)) {
            echo "<a class='btn btn-primary' href='" . $safeEditUrl . "'>"
                . __('Edit IntegaGLPI permissions', 'integaglpi') . '</a>';
        }

        echo '</div>';
        echo '</div>';
    }

    /**
     * Prefer the canonical GLPI right. Legacy names are only a migration fallback
     * for installations that have not created plugin_integaglpi yet.
     *
     * @param array<string, mixed> $currentRights
     */
    private static function resolveDisplayedRightValue(array $currentRights): int
    {
        if (array_key_exists(Plugin::RIGHT_NAME, $currentRights)) {
            return (int) $currentRights[Plugin::RIGHT_NAME];
        }

        return (int) ($currentRights['PluginIntegaglpi'] ?? 0)
            | (int) ($currentRights['PluginWhatsapp'] ?? 0);
    }

    private static function ensureCanonicalRightRegistered(): void
    {
        try {
            ProfileRight::addProfileRights([Plugin::RIGHT_NAME]);
        } catch (\Throwable $exception) {
            $message = $exception->getMessage();

            if (!str_contains($message, '(1062)') && !str_contains($message, '1062')) {
                error_log('[integaglpi][rights] addProfileRights failed: ' . $message);
            }
        }
    }

    private static function escapeAttribute(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
