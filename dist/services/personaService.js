"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.personaService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class PersonaService {
    constructor() {
        this.personas = new Map();
        this.manifest = [];
        this.loadPersonas();
    }
    loadPersonas() {
        try {
            // Load manifest
            const manifestPath = path.join(__dirname, '../../personas/manifest.json');
            const manifestData = fs.readFileSync(manifestPath, 'utf-8');
            this.manifest = JSON.parse(manifestData);
            // Load individual persona files
            for (const personaMeta of this.manifest) {
                if (personaMeta.safe_reviewed) {
                    const personaPath = path.join(__dirname, '../../personas', `${personaMeta.id}.json`);
                    if (fs.existsSync(personaPath)) {
                        const personaData = fs.readFileSync(personaPath, 'utf-8');
                        const persona = JSON.parse(personaData);
                        this.personas.set(persona.country_key, persona);
                    }
                }
            }
            console.log(`Loaded ${this.personas.size} personas`);
        }
        catch (error) {
            console.error('Error loading personas:', error);
        }
    }
    getPersona(countryKey) {
        return this.personas.get(countryKey) || null;
    }
    getAllPersonas() {
        return Array.from(this.personas.values());
    }
    getManifest() {
        return this.manifest.filter(p => p.safe_reviewed);
    }
    isValidCountryKey(countryKey) {
        return this.personas.has(countryKey);
    }
    reloadPersonas() {
        this.personas.clear();
        this.loadPersonas();
    }
}
exports.personaService = new PersonaService();
//# sourceMappingURL=personaService.js.map