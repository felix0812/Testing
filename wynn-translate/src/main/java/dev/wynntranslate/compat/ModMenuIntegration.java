package dev.wynntranslate.compat;

import com.terraformersmc.modmenu.api.ConfigScreenFactory;
import com.terraformersmc.modmenu.api.ModMenuApi;
import dev.wynntranslate.ui.LanguageScreen;

/** Zahnrad-Knopf in Mod Menu (nur aktiv, wenn Mod Menu installiert ist). */
public class ModMenuIntegration implements ModMenuApi {
    @Override
    public ConfigScreenFactory<?> getModConfigScreenFactory() {
        return parent -> new LanguageScreen(parent, false);
    }
}
