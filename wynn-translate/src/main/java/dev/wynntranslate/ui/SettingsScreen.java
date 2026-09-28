package dev.wynntranslate.ui;

import dev.wynntranslate.WynnTranslateClient;
import dev.wynntranslate.config.ModConfig;
import java.util.Locale;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.CycleButton;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

public class SettingsScreen extends Screen {
    private final Screen parent;
    private int keyLabelY;

    public SettingsScreen(Screen parent) {
        super(Component.translatable("wynntranslate.screen.settings.title"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        ModConfig config = WynnTranslateClient.get().config();
        int w = 240;
        int x = (width - w) / 2;
        int y = 32;

        addRenderableWidget(CycleButton.onOffBuilder(config.enabled)
                .create(x, y, w, 20, Component.translatable("wynntranslate.option.enabled"),
                        (button, value) -> config.enabled = value));
        y += 24;
        addRenderableWidget(CycleButton.builder((ModConfig.OverlayPosition p) ->
                                Component.translatable("wynntranslate.position." + p.name().toLowerCase(Locale.ROOT)),
                        config.overlayPosition)
                .withValues(ModConfig.OverlayPosition.values())
                .create(x, y, w, 20, Component.translatable("wynntranslate.option.position"),
                        (button, value) -> config.overlayPosition = value));
        y += 24;
        addRenderableWidget(CycleButton.onOffBuilder(config.showInChat)
                .create(x, y, w, 20, Component.translatable("wynntranslate.option.show_in_chat"),
                        (button, value) -> config.showInChat = value));
        y += 24;
        addRenderableWidget(CycleButton.onOffBuilder(config.translateChatDialogue)
                .create(x, y, w, 20, Component.translatable("wynntranslate.option.chat_dialogue"),
                        (button, value) -> config.translateChatDialogue = value));
        y += 24;
        addRenderableWidget(CycleButton.builder((ModConfig.Provider p) ->
                                Component.literal(p == ModConfig.Provider.GOOGLE ? "Google Translate" : "DeepL"),
                        config.provider)
                .withValues(ModConfig.Provider.values())
                .create(x, y, w, 20, Component.translatable("wynntranslate.option.provider"),
                        (button, value) -> config.provider = value));
        y += 34;
        keyLabelY = y - 10;
        EditBox keyBox = new EditBox(font, x, y, w, 20, Component.translatable("wynntranslate.option.deepl_key"));
        keyBox.setMaxLength(128);
        keyBox.setValue(config.deeplKey);
        keyBox.setHint(Component.translatable("wynntranslate.option.deepl_key.hint"));
        keyBox.setResponder(value -> config.deeplKey = value.trim());
        addRenderableWidget(keyBox);
        y += 28;

        addRenderableWidget(Button.builder(Component.translatable("wynntranslate.option.clear_cache"), button -> {
                    WynnTranslateClient.get().translations().clearCache();
                    button.active = false;
                })
                .bounds(x, y, w, 20)
                .build());

        addRenderableWidget(Button.builder(Component.translatable("gui.done"), button -> onClose())
                .bounds(width / 2 - 100, Math.max(y + 28, height - 28), 200, 20)
                .build());
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float delta) {
        super.render(graphics, mouseX, mouseY, delta);
        graphics.drawCenteredString(font, title, width / 2, 14, 0xFFFFFFFF);
        graphics.drawString(font, Component.translatable("wynntranslate.option.deepl_key"), (width - 240) / 2, keyLabelY, 0xFFA0A0A0);
    }

    @Override
    public void onClose() {
        WynnTranslateClient.get().config().save();
        minecraft.setScreen(parent);
    }
}
