"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.signOut = exports.signIn = exports.auth = exports.handlers = exports.authConfig = void 0;
const next_auth_1 = __importDefault(require("next-auth"));
const credentials_1 = __importDefault(require("next-auth/providers/credentials"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("./services/db");
// Define auth config
exports.authConfig = {
    providers: [
        (0, credentials_1.default)({
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" }
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    return null;
                }
                const supabase = (0, db_1.getSupabase)();
                // Find user by email
                const { data: user, error } = await supabase
                    .from('users')
                    .select('*')
                    .eq('email', credentials.email)
                    .single();
                if (error || !user) {
                    return null;
                }
                // Verify password
                const isValid = await bcryptjs_1.default.compare(credentials.password, user.password_hash);
                if (!isValid) {
                    return null;
                }
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                };
            }
        })
    ],
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user;
            const isOnDashboard = nextUrl.pathname.startsWith("/dashboard");
            if (isOnDashboard) {
                if (isLoggedIn)
                    return true;
                return false; // Redirect unauthenticated users to login page
            }
            else if (isLoggedIn) {
                // Redirect logged in users to Dashboard page if they try to access login page
                return Response.redirect(new URL("/dashboard", nextUrl));
            }
            return true;
        },
        async session({ session, user }) {
            if (session.user) {
                session.user.id = user.id;
            }
            return session;
        },
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
            }
            return token;
        }
    },
    pages: {
        signIn: "/login",
        signOut: "/login",
    },
};
_a = (0, next_auth_1.default)(exports.authConfig), exports.handlers = _a.handlers, exports.auth = _a.auth, exports.signIn = _a.signIn, exports.signOut = _a.signOut;
//# sourceMappingURL=auth.js.map