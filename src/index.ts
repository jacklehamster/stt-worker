import { JWT } from "google-auth-library";

export default {
  async fetch(request: Request, env: any) {
    const url = new URL(request.url);

    // Handle favicon redirect
    if (url.pathname === '/favicon.ico') {
      return Response.redirect("https://jacklehamster.github.io/stt-worker/icon.png");
    }

    // Serve HTML for GET requests to root
    if (request.method === "GET" && url.pathname === "/") {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Speech-to-Text</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            pre { background: #f0f0f0; padding: 10px; }
            button { margin: 5px; }
          </style>
        </head>
        <body>
          <h1>Speech-to-Text Demo</h1>
          <button id="recordButton">Start Recording</button>
          <button id="stopButton" disabled>Stop Recording</button>
          <input type="file" id="audioFile" accept="audio/*">
          <button onclick="uploadFile()">Transcribe File</button>
          <pre id="result">Transcription will appear here...</pre>

          <script>
            let mediaRecorder;
            let audioChunks = [];

            // Microphone recording
            document.getElementById("recordButton").addEventListener("click", async () => {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });

              mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
              };

              mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: "audio/webm;codecs=opus" });
                audioChunks = []; // Reset for next recording
                await uploadAudio(audioBlob);
                stream.getTracks().forEach(track => track.stop()); // Stop microphone
              };

              audioChunks = [];
              mediaRecorder.start();
              document.getElementById("recordButton").disabled = true;
              document.getElementById("stopButton").disabled = false;
            });

            document.getElementById("stopButton").addEventListener("click", () => {
              mediaRecorder.stop();
              document.getElementById("recordButton").disabled = false;
              document.getElementById("stopButton").disabled = true;
            });

            // File upload (existing functionality)
            async function uploadFile() {
              const fileInput = document.getElementById("audioFile");
              const file = fileInput.files[0];
              if (!file) {
                alert("Please select an audio file");
                return;
              }
              await uploadAudio(file);
            }

            // Shared upload function
            async function uploadAudio(audioBlob) {
              const response = await fetch("", {
                method: "POST",
                body: audioBlob,
                headers: { "Content-Type": audioBlob.type },
              });

              if (!response.ok) {
                alert("Error transcribing audio");
                return;
              }

              const { text } = await response.json();
              document.getElementById("result").textContent = text;
            }
          </script>
        </body>
        </html>
      `;
      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Handle POST for speech-to-text
    if (request.method !== "POST") {
      return new Response("Method not allowed. Use POST with audio data.", {
        status: 405,
        headers: { "Content-Type": "text/plain" },
      });
    }

    if (!env.SHEETS_SERVICE_KEY_JSON) {
      return new Response("Missing service credentials", { status: 500 });
    }

    const audioBuffer = await request.arrayBuffer();
    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return new Response("No audio data provided", { status: 400 });
    }

    // Convert ArrayBuffer to base64
    const audioBytes = new Uint8Array(audioBuffer);
    const binaryString = String.fromCharCode(...audioBytes);
    const audioBase64 = btoa(binaryString);

    const sttApiUrl = "https://speech.googleapis.com/v1/speech:recognize";
    const authToken = await getAuthToken(env.SHEETS_SERVICE_KEY_JSON);

    const payload = {
      config: {
        encoding: "MP3",
        sampleRateHertz: 16000,
        languageCode: "en-US",
      },
      audio: {
        content: audioBase64,
      },
    };

    let sttResponse;
    try {
      sttResponse = await fetch(sttApiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      return new Response(`Fetch error: ${err.message}`, { status: 503 });
    }

    if (!sttResponse.ok) {
      const errorText = await sttResponse.text();
      return new Response(`STT API error: ${errorText}`, { status: 500 });
    }

    const result: any = await sttResponse.json();
    const transcription = result.results?.[0]?.alternatives?.[0]?.transcript || "No transcription available";

    return new Response(JSON.stringify({ text: transcription }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  },
};

async function getAuthToken(credentials: string) {
  const { JWT } = await import("google-auth-library");
  const creds = JSON.parse(credentials);
  const client = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const token = await client.authorize();
  return token.access_token;
}
