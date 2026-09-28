package dev.wynntranslate.mixin;

import dev.wynntranslate.WynnTranslateClient;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundSetActionBarTextPacket;
import net.minecraft.network.protocol.game.ClientboundSystemChatPacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Liest Systemnachrichten direkt aus dem Paket, bevor andere Mods (z. B. Wynntils) sie verändern.
 * Es wird nur gelesen, nichts verändert oder abgebrochen.
 */
@Mixin(ClientPacketListener.class)
public abstract class ClientPacketListenerMixin {
    @Inject(method = "handleSystemChat", at = @At("HEAD"))
    private void wynntranslate$onSystemChat(ClientboundSystemChatPacket packet, CallbackInfo ci) {
        // Das Paket kommt zuerst auf dem Netzwerk-Thread an und wird dann auf den Hauptthread verschoben
        if (!Minecraft.getInstance().isSameThread()) return;
        try {
            WynnTranslateClient.onSystemMessage(packet.content(), packet.overlay());
        } catch (RuntimeException e) {
            WynnTranslateClient.LOGGER.error("Fehler beim Verarbeiten einer Nachricht", e);
        }
    }

    /** Zweiter Weg für Aktionsleisten-Text (z. B. /title … actionbar). */
    @Inject(method = "setActionBarText", at = @At("HEAD"))
    private void wynntranslate$onActionBar(ClientboundSetActionBarTextPacket packet, CallbackInfo ci) {
        if (!Minecraft.getInstance().isSameThread()) return;
        try {
            WynnTranslateClient.onSystemMessage(packet.text(), true);
        } catch (RuntimeException e) {
            WynnTranslateClient.LOGGER.error("Fehler beim Verarbeiten der Aktionsleiste", e);
        }
    }
}
