import { Persona } from '../types';
declare class PersonaService {
    private personas;
    private manifest;
    constructor();
    private loadPersonas;
    getPersona(countryKey: string): Persona | null;
    getAllPersonas(): Persona[];
    getManifest(): Persona[];
    isValidCountryKey(countryKey: string): boolean;
    reloadPersonas(): void;
}
export declare const personaService: PersonaService;
export {};
//# sourceMappingURL=personaService.d.ts.map