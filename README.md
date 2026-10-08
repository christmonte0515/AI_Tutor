# AI_Tutor
This is AI tutor project for IT vocational school students.

Each subject has its own AI teacher. Students chat with the teachers their human teacher has enabled for them; teachers manage access, subjects, content restrictions, learning goals and prompt history.

| Package        | What it is                                                          |
| -------------- | ------------------------------------------------------------------- |
| `server/`      | Node.js API server (Express + built-in SQLite), talks to Ollama     |
| `admin-app/`   | Electron app for teachers                                           |
| `student-app/` | Electron app for students (also served to browsers at `/student`)   |

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite`)
- [Ollama](https://ollama.com) with the **Qwen3 1.7B** model

## Setup

1. **Ollama**: install it from [ollama.com](https://ollama.com), then download the model:
   ```bash
   ollama pull qwen3:1.7b
   ```
   The Ollama app runs in the background on port 11434 (or start it with `ollama serve`). Check with `ollama list`.

2. **Server**
   ```bash
   cd server
   npm install
   npm run create-admin -- teacher@school.edu "a-long-password" "Ms. Lee"
   npm start
   ```

3. **Teacher app**
   ```bash
   cd admin-app
   npm install
   npm start
   ```

4. **Student app**
   ```bash
   cd student-app
   npm install
   npm start
   ```

Both apps connect to `http://localhost:3000` by default. Change it with the `AI_TUTOR_SERVER_URL` environment variable, or under "Server settings" on the sign-in screen.

New students have **no** AI teachers until a teacher enables them under *Students & access*.

Each subject shows the logo of its technology (Python, Cisco, MySQL, ...). The logos come from [Simple Icons](https://simpleicons.org) (CC0) and are served by the server at `/icons/<slug>.svg`. Teachers pick a logo per subject in *Domains & subjects*. Brand logos are trademarks of their owners and are shown only to identify each subject's technology.

## Server configuration

| Variable                | Default                    | Purpose                                                                  |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `PORT` / `HOST`         | `3000` / `127.0.0.1`       | Use `HOST=0.0.0.0` to serve other computers on the school network        |
| `OLLAMA_URL`            | `http://127.0.0.1:11434`   | Ollama server address                                                    |
| `OLLAMA_MODEL`          | `qwen3:1.7b`               | Model name as shown by `ollama list`                                     |
| `OLLAMA_TEMPERATURE`    | `0.3`                      | Low temperature keeps answers consistent                                 |
| `OLLAMA_MAX_TOKENS`     | `700`                      | Maximum reply length                                                     |
| `OLLAMA_NUM_CTX`        | `8192`                     | Context window; fits the system prompt plus recent conversation          |
| `OLLAMA_KEEP_ALIVE`     | `30m`                      | How long the model stays in memory after a request                       |
| `ALLOWED_EMAIL_DOMAINS` | (any)                      | Comma-separated, e.g. `student.myschool.edu`; restricts student sign-up |
| `SCOPE_CHECK`           | `hybrid`                   | Off-subject detection: `keyword`, `llm`, `hybrid` or `off`               |
| `HISTORY_MESSAGES`      | `12`                       | Previous messages sent to the model for context                          |
| `PROMPT_RETENTION_DAYS` | `0` (keep)                 | Automatically delete prompt history older than this                      |
| `SERVE_WEB_CLIENT`      | `true`                     | Serve the student UI to browsers at `/student`                           |
| `DATA_DIR`              | `server/data`              | Database and generated secrets                                           |
| `JWT_SECRET`, `DATA_ENCRYPTION_KEY` | generated      | Generated into `DATA_DIR` on first start if not set. Back them up: without the key, stored chats can't be decrypted |

Run the server tests with `cd server && npm test`.

## How the tutoring principles are implemented

A 1.7B model can't be relied on to follow every instruction, so the important rules are enforced by the server in code. The system prompt covers the rest.

**Enforced by the server**
- **Subject scope**: before the model is called, the question is checked against every subject's keywords. In `hybrid` mode, unclear questions are also classified by the model. Questions that belong to another subject get a fixed reply naming the right teacher, and the reply says whether the student has access to that teacher.
- **Access control**: every request checks that the student is still assigned to the subject. Removing access locks existing chats with that teacher.
- **Content restrictions**: teachers' rules are added to every prompt. Blocked keywords are also enforced in code. Questions containing them are refused without calling the model, and answers containing them are stopped mid-stream and replaced.
- **Learning goals**: the active goals are added to the system prompt on every request.
- **Boundary recognition**: messages about self-harm, abuse or bullying get a fixed reply referring the student to a teacher, counselor or parent, and are flagged in the prompt history.
- **Hidden reasoning**: Qwen3's thinking mode is turned off (Ollama `think: false`) so replies start quickly. Any `<think>` text that still appears is removed from the stream before students see it.
- **Model always ready**: the server preloads the model at startup and asks Ollama to keep it in memory (`OLLAMA_KEEP_ALIVE`), so students don't wait for it to load.
- **Privacy**: messages and prompt history are encrypted at rest with AES-256-GCM, and passwords are hashed with scrypt. Sign-in tokens are kept in memory only, so closing the app signs the student out (useful on shared lab computers).

**Handled by the system prompt and the UI**
- **Teaching style** (scaffolding, Socratic questions, metacognition, patience, encouragement, no shaming, honesty about uncertainty, admitting mistakes): set by the system prompt. The student UI adds quick buttons for "Give me a hint", "Explain it another way", "Check my understanding", "Help me plan" and "I think that's wrong".
- **Frustration**: when a message shows frustration, the prompt tells the model to acknowledge it and offer a smaller next step.
- **Disclosure of AI nature**: every chat opens with a greeting that says the tutor is an AI. A badge in the header and a note under the message box repeat this.
- **Accessibility**: the UI uses semantic HTML, works fully from the keyboard, and announces replies to screen readers. Students can change the text size and turn on high contrast. It follows the system's dark mode and reduced-motion settings, and the layout adapts to narrow screens.
- **Low latency**: replies stream token by token, and fixed replies (redirects, refusals, wellbeing referrals) skip the model entirely.
