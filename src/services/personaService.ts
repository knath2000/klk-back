import * as fs from 'fs';
import * as path from 'path';
import { Persona } from '../types';

class PersonaService {
  private personas: Map<string, Persona> = new Map();
  private manifest: Persona[] = [];

  constructor() {
    this.loadPersonas();
  }

  private loadPersonas(): void {
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
            const persona: Persona = JSON.parse(personaData);
            this.personas.set(persona.country_key, persona);
          }
        }
      }

      console.log(`Loaded ${this.personas.size} personas`);
    } catch (error) {
      console.error('Error loading personas:', error);
    }
  }

  getPersona(countryKey: string): Persona | null {
    return this.personas.get(countryKey) || null;
  }

  getAllPersonas(): Persona[] {
    return Array.from(this.personas.values());
  }

  getManifest(): Persona[] {
    return this.manifest.filter(p => p.safe_reviewed);
  }

  isValidCountryKey(countryKey: string): boolean {
    return this.personas.has(countryKey);
  }

  reloadPersonas(): void {
    this.personas.clear();
    this.loadPersonas();
  }
}

export const personaService = new PersonaService();