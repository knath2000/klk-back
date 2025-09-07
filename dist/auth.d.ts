import { Session, User } from "next-auth";
export declare const authConfig: {
    providers: import("next-auth/providers/credentials").CredentialsConfig<{
        email: {
            label: string;
            type: string;
        };
        password: {
            label: string;
            type: string;
        };
    }>[];
    callbacks: {
        authorized({ auth, request: { nextUrl } }: {
            auth: any;
            request: {
                nextUrl: any;
            };
        }): boolean | Response;
        session({ session, user }: {
            session: Session;
            user: User;
        }): Promise<Session>;
        jwt({ token, user }: {
            token: any;
            user: any;
        }): Promise<any>;
    };
    pages: {
        signIn: string;
        signOut: string;
    };
};
export declare const handlers: any, auth: any, signIn: any, signOut: any;
//# sourceMappingURL=auth.d.ts.map