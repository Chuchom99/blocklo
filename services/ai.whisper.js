import axios from "axios";
import FormData from "form-data";

export async function transcribeVoice(mediaUrl) {
  const res = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
  });

  const form = new FormData();
  form.append("file", res.data, { filename: "voice.ogg" });
  form.append("model", "whisper-1");

  const { data } = await axios.post(
    "https://api.openai.com/v1/audio/transcriptions",
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
    }
  );

  return data.text;
}