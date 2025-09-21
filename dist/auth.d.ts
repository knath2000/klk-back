import { Session, User } from "next-auth";
export declare const authConfig: {
    providers: any[];
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