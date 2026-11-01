// Google permissions Little asks for.

// Sign-in: `drive.file` lets Little see only the files it creates in the
// user's Drive. Google treats it as a non-sensitive scope.
export const BASE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"].join(" ");

// Asked for only when the user connects Google Calendar on the Meetings page:
// read-only access to calendar events.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
