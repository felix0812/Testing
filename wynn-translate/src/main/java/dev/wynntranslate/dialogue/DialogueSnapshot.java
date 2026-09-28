package dev.wynntranslate.dialogue;

import java.util.List;

/**
 * Momentaufnahme eines NPC-Dialogs aus der Aktionsleiste.
 *
 * @param body          der (bereits getippte) Dialogtext
 * @param choices       Antwortmöglichkeiten, falls der Dialog welche anbietet
 * @param requiresShift {@code true}, sobald der Text fertig ist und mit Shift weitergeklickt werden kann
 */
public record DialogueSnapshot(String body, List<String> choices, boolean requiresShift) {}
