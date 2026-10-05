import { isSessionActive, verifyAccessToken } from "../services/auth.service.js";
import UserService from "../services/user.service.js";
import { unauthorized, forbidden } from "../utils/errors.js";

// Authenticates a web/mobile request from its Bearer access token.
// Sets req.user (with req.user.accounts[0] as the primary wallet).
export async function requireAuth(req, res, next) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw unauthorized();

  const claims = verifyAccessToken(header.slice(7));
  if (!claims) throw unauthorized("Invalid or expired token");
  // Checked per request so logout and refresh-token reuse take effect immediately.
  if (!(await isSessionActive(claims.sid))) throw unauthorized("Session ended");

  const user = await UserService.findById(claims.sub);
  if (!user) throw unauthorized();
  if (user.status === "BLOCKED") throw forbidden("Account restricted");

  req.user = user;
  req.sessionId = claims.sid;
  next();
}
