package dev.wynntranslate.translate;

import dev.wynntranslate.config.Language;
import java.io.IOException;

public interface TranslationProvider {
    /** Übersetzt englischen Text in die Zielsprache. Blockiert; wird im Hintergrund aufgerufen. */
    String translate(String text, Language target) throws IOException, InterruptedException;
}
