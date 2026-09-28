package dev.wynntranslate.gametest;

import dev.wynntranslate.WynnTranslateClient;
import dev.wynntranslate.config.Language;
import dev.wynntranslate.ui.LanguageScreen;
import dev.wynntranslate.ui.SettingsScreen;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.fabricmc.fabric.api.client.gametest.v1.context.TestSingleplayerContext;

/**
 * Startet ein echtes Spiel, simuliert einen Wynncraft-Dialog in der Aktionsleiste und prüft,
 * dass die Übersetzung ankommt. Screenshots landen unter build/run/clientGameTest/screenshots.
 */
public class WynnTranslateClientGameTest implements FabricClientGameTest {
    private static final String DIALOGUE = "Hello traveler! The corrupted have taken the village. Will you help us?";

    @Override
    public void runTest(ClientGameTestContext context) {
        context.runOnClient(client -> {
            WynnTranslateClient.get().config().language = Language.GERMAN;
            WynnTranslateClient.get().config().enabled = true;
        });

        context.setScreen(() -> new LanguageScreen(null, false));
        context.waitTicks(5);
        context.takeScreenshot("wynntranslate-language-screen");
        context.setScreen(() -> new SettingsScreen(null));
        context.waitTicks(5);
        context.takeScreenshot("wynntranslate-settings-screen");
        context.setScreen(() -> null);

        try (TestSingleplayerContext singleplayer = context.worldBuilder().create()) {
            singleplayer.getClientWorld().waitForChunksRender();

            String json = "[{\"text\":\"" + DIALOGUE + "\",\"font\":\"minecraft:hud/dialogue/text/body_0\"},"
                    + "{\"text\":\"Yes, I will help.\",\"font\":\"minecraft:hud/dialogue/text/choice_0\"},"
                    + "{\"text\":\" \",\"font\":\"minecraft:hud/dialogue/text/control\"}]";
            // Aktionsleiste mehrfach senden, wie Wynncraft es tut, und auf die Übersetzung warten
            for (int i = 0; i < 20; i++) {
                singleplayer.getServer().runCommand("title @a actionbar " + json);
                context.waitTicks(10);
                boolean done = context.computeOnClient(client ->
                        WynnTranslateClient.get().translations().cached(Language.GERMAN, DIALOGUE).isPresent()
                                && WynnTranslateClient.get().translations().cached(Language.GERMAN, "Yes, I will help.").isPresent());
                if (done) break;
            }
            singleplayer.getServer().runCommand("title @a actionbar " + json);
            context.waitTicks(5);
            context.takeScreenshot("wynntranslate-dialogue-overlay");

            String translation = context.computeOnClient(client ->
                    WynnTranslateClient.get().translations().cached(Language.GERMAN, DIALOGUE).orElse(null));
            if (translation == null) {
                throw new AssertionError("Dialog wurde nicht übersetzt");
            }
            if (!context.computeOnClient(client -> WynnTranslateClient.get().tracker().isFinished())) {
                throw new AssertionError("Dialog wurde nicht als fertig erkannt");
            }
            System.out.println("[WynnTranslate-Test] Übersetzung: " + translation);
        }
    }
}
