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
            // More robust path resolution for container environments
            const basePath = process.cwd();
            const personasDir = path.join(basePath, 'personas');
            console.log('🔍 PersonaService Path Resolution:');
            console.log('   Process CWD:', basePath);
            console.log('   Personas directory path:', personasDir);
            // Check if personas directory exists
            if (!fs.existsSync(personasDir)) {
                console.error('❌ Personas directory not found at:', personasDir);
                // Try alternative paths commonly used in containers
                const alternativePaths = [
                    path.join(basePath, 'server', 'personas'),
                    path.join(basePath, '..', 'server', 'personas'),
                    path.join('/app', 'personas'),
                    path.join(__dirname, '..', '..', 'personas')
                ];
                console.log('🔍 Trying alternative paths:');
                for (const altPath of alternativePaths) {
                    console.log('   Checking:', altPath, 'Exists:', fs.existsSync(altPath));
                    if (fs.existsSync(altPath)) {
                        console.log('✅ Found personas directory at alternative path:', altPath);
                        this.loadPersonasFromDirectory(altPath);
                        return;
                    }
                }
                // List what's actually in the current directory
                try {
                    console.log('📂 Current directory contents:', fs.readdirSync(basePath));
                    if (fs.existsSync(path.join(basePath, 'server'))) {
                        console.log('📂 Server directory contents:', fs.readdirSync(path.join(basePath, 'server')));
                    }
                }
                catch (listError) {
                    console.error('❌ Error listing directory contents:', listError);
                }
                return;
            }
            // Load personas from found directory
            this.loadPersonasFromDirectory(personasDir);
        }
        catch (error) {
            console.error('💥 Error in loadPersonas:', error);
            console.error('_STACK:', error instanceof Error ? error.stack : String(error));
        }
    }
    loadPersonasFromDirectory(personasDir) {
        try {
            console.log('📂 Loading personas from directory:', personasDir);
            const manifestPath = path.join(personasDir, 'manifest.json');
            console.log('🔍 Looking for manifest at:', manifestPath);
            if (!fs.existsSync(manifestPath)) {
                console.error('❌ Manifest file not found:', manifestPath);
                console.log('📂 Files in personas directory:', fs.readdirSync(personasDir));
                return;
            }
            const manifestData = fs.readFileSync(manifestPath, 'utf-8');
            this.manifest = JSON.parse(manifestData);
            console.log('📚 Manifest loaded with', this.manifest.length, 'entries');
            // Load individual persona files
            for (const personaMeta of this.manifest) {
                if (personaMeta.safe_reviewed) {
                    const personaPath = path.join(personasDir, `${personaMeta.id}.json`);
                    console.log('🔍 Looking for persona file:', personaPath);
                    if (fs.existsSync(personaPath)) {
                        const personaData = fs.readFileSync(personaPath, 'utf-8');
                        const persona = JSON.parse(personaData);
                        this.personas.set(persona.country_key, persona);
                        console.log('✅ Loaded persona:', persona.country_key, '-', persona.displayName);
                    }
                    else {
                        console.error('❌ Persona file not found:', personaPath);
                        console.log('📂 Available files:', fs.readdirSync(personasDir));
                    }
                }
            }
            console.log(`📚 Successfully loaded ${this.personas.size} personas`);
        }
        catch (error) {
            console.error('💥 Error loading personas from directory:', error);
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