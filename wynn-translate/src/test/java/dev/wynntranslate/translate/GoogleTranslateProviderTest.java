package dev.wynntranslate.translate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import org.junit.jupiter.api.Test;

class GoogleTranslateProviderTest {
    @Test
    void joinsSentences() throws IOException {
        String body = "[[[\"Hallo Reisender! \",\"Hello traveler! \",null,null,3],"
                + "[\"Hilfst du uns?\",\"Will you help us?\",null,null,3]],null,\"en\"]";
        assertEquals("Hallo Reisender! Hilfst du uns?", GoogleTranslateProvider.parseResponse(body));
    }

    @Test
    void rejectsGarbage() {
        assertThrows(IOException.class, () -> GoogleTranslateProvider.parseResponse("<html>429</html>"));
    }
}
