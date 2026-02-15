/**
 * Telegram Bot API helper functions.
 */

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const MAX_LENGTH = 4096;

  for (let i = 0; i < text.length; i += MAX_LENGTH) {
    const chunk = text.slice(i, i + MAX_LENGTH);
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
      });
    } catch (err) {
      console.error(`[telegram] Failed to send message to ${chatId}:`, err);
    }
  }
}
