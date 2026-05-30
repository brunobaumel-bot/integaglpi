<?php

declare(strict_types=1);

use GlpiPlugin\Integaglpi\Plugin;
use GlpiPlugin\Integaglpi\Profile as IntegaglpiProfile;

include '../../../inc/includes.php';

Session::checkLoginUser();

// TEMP DIAGNOSTIC: capture method, raw inputs, user/profile context.
// Safe (no secrets logged); remove once root cause is confirmed.
$debugTag = '[integaglpi][profile.form]';
$reqMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$rawGetProfilesId = $_GET['profiles_id'] ?? null;
$rawGetId         = $_GET['id'] ?? null;
$rawPostProfilesId = $_POST['profiles_id'] ?? null;
$rawPostId         = $_POST['id'] ?? null;

error_log(sprintf(
    '%s ENTER method=%s GET[profiles_id]=%s GET[id]=%s POST[profiles_id]=%s POST[id]=%s user=%s activeProfile=%s',
    $debugTag,
    $reqMethod,
    var_export($rawGetProfilesId, true),
    var_export($rawGetId, true),
    var_export($rawPostProfilesId, true),
    var_export($rawPostId, true),
    var_export(Session::getLoginUserID(), true),
    var_export($_SESSION['glpiactiveprofile']['id'] ?? null, true)
));

// Permission check: must be able to UPDATE profiles in GLPI core.
// Use haveRight (not checkRight) so we can log the result before bailing out.
$canUpdateProfile = Session::haveRight(\Profile::$rightname, UPDATE);
error_log(sprintf(
    '%s haveRight(%s, UPDATE)=%s',
    $debugTag,
    \Profile::$rightname,
    var_export($canUpdateProfile, true)
));

if (!$canUpdateProfile) {
    Session::checkRight(\Profile::$rightname, UPDATE); // displays standard error and dies
}

// Accept both `profiles_id` (plugin convention) and `id` (GLPI convention)
// from GET/POST, in that order, to be robust against any caller that uses
// either name.
$profileIdSource = 'none';
$profileId = 0;

if ($reqMethod === 'POST') {
    if (isset($_POST['profiles_id']) && $_POST['profiles_id'] !== '') {
        $profileId = (int) $_POST['profiles_id'];
        $profileIdSource = 'POST.profiles_id';
    } elseif (isset($_POST['id']) && $_POST['id'] !== '') {
        $profileId = (int) $_POST['id'];
        $profileIdSource = 'POST.id';
    }
} else {
    if (isset($_GET['profiles_id']) && $_GET['profiles_id'] !== '') {
        $profileId = (int) $_GET['profiles_id'];
        $profileIdSource = 'GET.profiles_id';
    } elseif (isset($_GET['id']) && $_GET['id'] !== '') {
        $profileId = (int) $_GET['id'];
        $profileIdSource = 'GET.id';
    }
}

error_log(sprintf(
    '%s resolved profileId=%d via %s',
    $debugTag,
    $profileId,
    $profileIdSource
));

$profile = new \Profile();
if ($profileId <= 0 || !$profile->getFromDB($profileId)) {
    error_log(sprintf(
        '%s INVALID profile load profileId=%d (source=%s) — redirecting to /front/profile.php',
        $debugTag,
        $profileId,
        $profileIdSource
    ));
    Session::addMessageAfterRedirect(__('Invalid profile.', 'integaglpi'), false, ERROR);
    Html::redirect($CFG_GLPI['root_doc'] . '/front/profile.php');
}

// From here on, always trust the loaded record's ID, never the raw input.
$profileId = (int) $profile->getID();
$profileName = (string) ($profile->fields['name'] ?? '');

error_log(sprintf(
    '%s loaded profile id=%d name=%s',
    $debugTag,
    $profileId,
    var_export($profileName, true)
));

if ($reqMethod === 'POST') {
    $hasSaveFlag = isset($_POST['save_plugin_integaglpi_rights']);

    // TEMP DIAGNOSTIC: dump CSRF state to confirm what reached us vs. what is in session.
    $postedToken = trim((string) ($_POST['_glpi_csrf_token'] ?? ''));
    $sessionTokenStore = $_SESSION['glpicsrftokens'] ?? null;
    $sessionTokenCount = is_array($sessionTokenStore) ? count($sessionTokenStore) : 0;
    $sessionTokenSample = '';
    if (is_array($sessionTokenStore)) {
        $firstKey = array_key_first($sessionTokenStore);
        if ($firstKey !== null) {
            $sessionTokenSample = substr((string) $firstKey, 0, 8) . '…';
        }
    }
    $tokenInStore = is_array($sessionTokenStore) && $postedToken !== ''
        && array_key_exists($postedToken, $sessionTokenStore);

    error_log(sprintf(
        '%s POST CSRF state posted=%s store_count=%d store_sample=%s posted_in_store=%s',
        $debugTag,
        $postedToken === '' ? '(empty)' : substr($postedToken, 0, 8) . '…',
        $sessionTokenCount,
        $sessionTokenSample === '' ? '(none)' : $sessionTokenSample,
        var_export($tokenInStore, true)
    ));

    $csrfValid = Plugin::isCsrfValid($_POST);

    error_log(sprintf(
        '%s POST checks save_flag=%s csrf_valid=%s',
        $debugTag,
        var_export($hasSaveFlag, true),
        var_export($csrfValid, true)
    ));

    if (!$hasSaveFlag) {
        Session::addMessageAfterRedirect(__('Invalid profile update request.', 'integaglpi'), false, ERROR);
        Html::redirect(Plugin::getWebBasePath() . '/front/profile.form.php?profiles_id=' . $profileId);
    }

    if (!$csrfValid) {
        Session::addMessageAfterRedirect(__('Invalid security token. Please try again.', 'integaglpi'), false, ERROR);
        Html::redirect(Plugin::getWebBasePath() . '/front/profile.form.php?profiles_id=' . $profileId);
    }

    $rightsValue = 0;

    if (!empty($_POST['rights_read'])) {
        $rightsValue |= READ;
    }

    if (!empty($_POST['rights_update'])) {
        $rightsValue |= UPDATE;
    }

    error_log(sprintf(
        '%s saving profileId=%d rightsValue=%d (read=%s update=%s)',
        $debugTag,
        $profileId,
        $rightsValue,
        var_export(!empty($_POST['rights_read']), true),
        var_export(!empty($_POST['rights_update']), true)
    ));

    IntegaglpiProfile::saveProfileRights($profileId, $rightsValue);

    $savedRights = \ProfileRight::getProfileRights($profileId, [Plugin::RIGHT_NAME]);
    $persistedValue = (int) ($savedRights[Plugin::RIGHT_NAME] ?? -1);

    error_log(sprintf(
        '%s post-save verify profileId=%d expected=%d persisted=%d',
        $debugTag,
        $profileId,
        $rightsValue,
        $persistedValue
    ));

    if ($persistedValue !== $rightsValue) {
        Session::addMessageAfterRedirect(__('Plugin Integaglpi rights were not persisted.', 'integaglpi'), false, ERROR);
    } else {
        Session::addMessageAfterRedirect(__('Plugin Integaglpi rights updated.', 'integaglpi'));
    }

    Html::redirect(Plugin::getWebBasePath() . '/front/profile.form.php?profiles_id=' . $profileId);
}

$rightFields = [
    Plugin::RIGHT_NAME,
    'PluginIntegaglpi',
    'PluginWhatsapp',
];
$currentRights = \ProfileRight::getProfileRights($profileId, $rightFields);

if (array_key_exists(Plugin::RIGHT_NAME, $currentRights)) {
    $rightValue = (int) $currentRights[Plugin::RIGHT_NAME];
} else {
    $rightValue = (int) ($currentRights['PluginIntegaglpi'] ?? 0)
        | (int) ($currentRights['PluginWhatsapp'] ?? 0);
}

error_log(sprintf(
    '%s GET render profileId=%d name=%s currentRightValue=%d',
    $debugTag,
    $profileId,
    var_export($profileName, true),
    $rightValue
));

$actionUrl = Plugin::getWebBasePath() . '/front/profile.form.php';
$backUrl = $CFG_GLPI['root_doc'] . '/front/profile.form.php?id=' . $profileId;
$escape = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

Html::header(__('PluginIntegaglpi permissions', 'integaglpi'), $_SERVER['PHP_SELF'], 'admin', \Profile::class);

// Phase: integaglpi_security_access_center_rbac_profiles_001_FIX1.
// Centralization notice: this screen now only edits the GLPI-native
// Read/Update bootstrap that gates access to the plugin. The granular
// IntegraGLPI matrix (Técnico/Supervisão/Direção) is managed exclusively
// at the Central de Segurança — link rendered below.
$securityCenterUrl = Plugin::getWebBasePath() . '/front/security.center.php';

echo "<div class='card'>";
echo "<div class='card-header d-flex align-items-center'>"
    . "<i class='ti ti-settings me-2'></i>"
    . "<span>" . __('Bootstrap GLPI — PluginIntegaglpi (Ler / Atualizar)', 'integaglpi') . "</span>"
    . '</div>';
echo "<div class='card-body'>";
echo "<div class='alert alert-warning d-flex align-items-center justify-content-between flex-wrap gap-2'>"
    . "<div>"
    . "<i class='ti ti-shield-lock me-1'></i><strong>"
    . __('As permissões granulares são geridas na Central de Segurança.', 'integaglpi')
    . '</strong><br>'
    . "<span class='small text-muted'>"
    . __('Aqui você define apenas o bootstrap Ler/Atualizar usado pelo GLPI como porta de entrada ao plugin. Técnico, Supervisão e Direção são configurados na Central de Segurança.', 'integaglpi')
    . '</span>'
    . '</div>'
    . "<a class='btn btn-primary' href='" . $escape($securityCenterUrl) . "'>"
    . "<i class='ti ti-shield-lock me-1'></i>" . __('Abrir Central de Segurança', 'integaglpi')
    . '</a>'
    . '</div>';
echo "<p class='mb-3'>" . __('Profile', 'integaglpi') . ': <strong>' . $escape($profileName) . '</strong> '
    . "<small class='text-muted'>(id=" . $profileId . ')</small></p>';
echo "<form method='post' action='" . $escape($actionUrl) . "'>";
echo Plugin::renderCsrfToken();
echo "<input type='hidden' name='profiles_id' value='" . $profileId . "'>";
echo "<input type='hidden' name='id' value='" . $profileId . "'>";
echo "<div class='mb-3'>";
echo "<label class='form-label'><input type='checkbox' name='rights_read' value='1' "
    . (($rightValue & READ) !== 0 ? "checked='checked'" : '') . '> ' . __('Read') . '</label>';
echo '</div>';
echo "<div class='mb-3'>";
echo "<label class='form-label'><input type='checkbox' name='rights_update' value='1' "
    . (($rightValue & UPDATE) !== 0 ? "checked='checked'" : '') . '> ' . __('Update') . '</label>';
echo '</div>';
echo "<button type='submit' name='save_plugin_integaglpi_rights' value='1' class='btn btn-primary me-2'>"
    . __('Save') . '</button>';
echo "<a class='btn btn-secondary' href='" . $escape($backUrl) . "'>" . __('Back') . '</a>';
echo '</form>';
echo '</div>';
echo '</div>';

Html::footer();
