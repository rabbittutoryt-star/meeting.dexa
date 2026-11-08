# DEXA Meeting — JavaScript backend

Requires Node.js 18+. Run `npm start` or double-click `start.bat` on Windows. Open http://localhost:3000.

No accounts, passwords, signup, or database. Enter a display name on first launch; a temporary browser guest ID is used for meeting participation. Display names are not verified identities. Guest profiles are held in server memory, and the name/guest ID are saved locally in the browser. Restarting the server clears sessions and active rooms. `@dexa` is a display handle suffix, **not an actual email domain or registered Internet domain**.

Meetings use browser WebRTC and Node.js long-poll signaling. HTTPS is needed for camera/microphone on remote production sites; configure TURN_URL, TURN_USERNAME, TURN_CREDENTIAL for connectivity across restrictive networks. Set PORT and MAX_ROOM_SIZE in `.env` as needed.
