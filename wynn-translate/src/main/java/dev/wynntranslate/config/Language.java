package dev.wynntranslate.config;

/**
 * Zielsprachen: die zehn meistgesprochenen Sprachen der Welt (ohne Englisch, das ist Wynncrafts
 * Originalsprache) plus Deutsch.
 */
public enum Language {
    ORIGINAL("en", "Original (English)", "Original", null, false),
    CHINESE("zh-CN", "中文", "Chinese", "ZH-HANS", false),
    HINDI("hi", "हिन्दी", "Hindi", null, false),
    SPANISH("es", "Español", "Spanish", "ES", false),
    ARABIC("ar", "العربية", "Arabic", "AR", true),
    FRENCH("fr", "Français", "French", "FR", false),
    BENGALI("bn", "বাংলা", "Bengali", null, false),
    PORTUGUESE("pt", "Português", "Portuguese", "PT-BR", false),
    RUSSIAN("ru", "Русский", "Russian", "RU", false),
    INDONESIAN("id", "Bahasa Indonesia", "Indonesian", "ID", false),
    URDU("ur", "اردو", "Urdu", null, true),
    GERMAN("de", "Deutsch", "German", "DE", false);

    private final String googleCode;
    private final String nativeName;
    private final String englishName;
    private final String deeplCode;
    private final boolean rightToLeft;

    Language(String googleCode, String nativeName, String englishName, String deeplCode, boolean rightToLeft) {
        this.googleCode = googleCode;
        this.nativeName = nativeName;
        this.englishName = englishName;
        this.deeplCode = deeplCode;
        this.rightToLeft = rightToLeft;
    }

    public String googleCode() {
        return googleCode;
    }

    public String nativeName() {
        return nativeName;
    }

    public String englishName() {
        return englishName;
    }

    /**
     * Beschriftung für die Auswahl. Sprachen mit nicht-lateinischer Schrift bekommen den englischen
     * Namen dazu, weil die Minecraft-Schrift z. B. Hindi oder Arabisch nur unvollkommen darstellt.
     */
    public boolean needsEnglishHint() {
        return this == CHINESE || this == HINDI || this == ARABIC || this == BENGALI || this == RUSSIAN || this == URDU;
    }

    /** DeepL-Sprachcode oder {@code null}, wenn DeepL die Sprache nicht anbietet. */
    public String deeplCode() {
        return deeplCode;
    }

    public boolean rightToLeft() {
        return rightToLeft;
    }

    public boolean translates() {
        return this != ORIGINAL;
    }
}
