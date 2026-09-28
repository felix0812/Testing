package dev.wynntranslate.ui;

import dev.wynntranslate.WynnTranslateClient;
import dev.wynntranslate.config.Language;
import dev.wynntranslate.config.ModConfig;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Checkbox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/** Sprachauswahl; erscheint beim Betreten von Wynncraft und über Taste L, /wtranslate oder Mod Menu. */
public class LanguageScreen extends Screen {
    private final Screen parent;
    private final boolean fromJoin;
    private int gridBottom;

    public LanguageScreen(Screen parent, boolean fromJoin) {
        super(Component.translatable("wynntranslate.screen.language.title"));
        this.parent = parent;
        this.fromJoin = fromJoin;
    }

    @Override
    protected void init() {
        ModConfig config = WynnTranslateClient.get().config();
        Language[] languages = Language.values();

        int columns = width >= 440 ? 3 : 2;
        int buttonWidth = columns == 3 ? 132 : 150;
        int gap = 4;
        int rows = (languages.length + columns - 1) / columns;
        int gridWidth = columns * buttonWidth + (columns - 1) * gap;
        int left = (width - gridWidth) / 2;
        int top = 36;

        for (int i = 0; i < languages.length; i++) {
            Language language = languages[i];
            int x = left + (i % columns) * (buttonWidth + gap);
            int y = top + (i / columns) * 22;
            String name = TranslationOverlay.shape(font, language.nativeName(), language);
            if (language.needsEnglishHint()) name = name + " (" + language.englishName() + ")";
            String label = (language == config.language ? "✔ " : "") + name;
            addRenderableWidget(Button.builder(Component.literal(label), button -> select(language))
                    .bounds(x, y, buttonWidth, 20)
                    .build());
        }
        gridBottom = top + rows * 22;

        addRenderableWidget(Checkbox.builder(Component.translatable("wynntranslate.screen.ask_on_join"), font)
                .pos(left, gridBottom + 18)
                .selected(config.askOnJoin)
                .onValueChange((checkbox, value) -> {
                    config.askOnJoin = value;
                    config.save();
                })
                .build());

        int bottom = Math.max(gridBottom + 44, height - 28);
        addRenderableWidget(Button.builder(Component.translatable("wynntranslate.screen.settings"),
                        button -> minecraft.setScreen(new SettingsScreen(this)))
                .bounds(width / 2 - 154, bottom, 150, 20)
                .build());
        addRenderableWidget(Button.builder(Component.translatable("gui.done"), button -> onClose())
                .bounds(width / 2 + 4, bottom, 150, 20)
                .build());
    }

    private void select(Language language) {
        ModConfig config = WynnTranslateClient.get().config();
        config.language = language;
        config.save();
        WynnTranslateClient.get().tracker().clear();
        if (fromJoin) {
            onClose();
        } else {
            rebuildWidgets();
        }
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float delta) {
        super.render(graphics, mouseX, mouseY, delta);
        graphics.drawCenteredString(font, title, width / 2, 12, 0xFFFFFFFF);
        graphics.drawCenteredString(font, Component.translatable("wynntranslate.screen.language.subtitle"), width / 2, 23, 0xFFA0A0A0);
        graphics.drawCenteredString(font, Component.translatable("wynntranslate.screen.language.hint"), width / 2, gridBottom + 4, 0xFF808080);
    }

    @Override
    public void onClose() {
        minecraft.setScreen(parent);
    }
}
