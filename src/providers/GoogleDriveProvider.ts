import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { StorageProvider, Memory, StorageConfig } from '../types/index.js';

export class GoogleDriveProvider implements StorageProvider {
  private oauth2Client: OAuth2Client;
  private drive: any;
  private config: StorageConfig['googleDrive'];
  private folderId?: string;
  private initialized = false;

  constructor(config: StorageConfig['googleDrive']) {
    if (!config?.clientId || !config?.clientSecret) {
      throw new Error('Google Drive configuration requires clientId and clientSecret');
    }
    
    this.config = config;
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      'urn:ietf:wg:oauth:2.0:oob'
    );

    if (config.refreshToken) {
      this.oauth2Client.setCredentials({
        refresh_token: config.refreshToken
      });
    }

    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
  }

  async initialize(): Promise<void> {
    try {
      if (!this.config?.refreshToken) {
        throw new Error('Google Drive refresh token not configured. Please run configuration first.');
      }

      await this.oauth2Client.getAccessToken();
      
      this.folderId = this.config.folderId || await this.findOrCreateFolder();
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async findOrCreateFolder(): Promise<string> {
    try {
      const response = await this.drive.files.list({
        q: "name='DeepMemory' and mimeType='application/vnd.google-apps.folder'",
        fields: 'files(id, name)'
      });

      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0].id;
      }

      const folderResponse = await this.drive.files.create({
        requestBody: {
          name: 'DeepMemory',
          mimeType: 'application/vnd.google-apps.folder'
        },
        fields: 'id'
      });

      return folderResponse.data.id;
    } catch (error) {
      throw new Error(`Failed to create DeepMemory folder: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async saveMemory(memory: Memory): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const data = JSON.stringify({
        ...memory,
        lastModified: new Date(),
        entries: memory.entries.map(entry => ({
          ...entry,
          timestamp: entry.timestamp.toISOString(),
          lastAccessed: entry.lastAccessed.toISOString()
        }))
      }, null, 2);

      const existingFile = await this.findMemoryFile();
      
      if (existingFile) {
        await this.drive.files.update({
          fileId: existingFile.id,
          media: {
            mimeType: 'application/json',
            body: data
          }
        });
      } else {
        await this.drive.files.create({
          requestBody: {
            name: 'memory.json',
            parents: [this.folderId]
          },
          media: {
            mimeType: 'application/json',
            body: data
          }
        });
      }
    } catch (error) {
      throw new Error(`Failed to save memory to Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async findMemoryFile(): Promise<any> {
    try {
      const response = await this.drive.files.list({
        q: `name='memory.json' and parents in '${this.folderId}'`,
        fields: 'files(id, name)'
      });

      return response.data.files && response.data.files.length > 0 ? response.data.files[0] : null;
    } catch (error) {
      return null;
    }
  }

  async loadMemory(): Promise<Memory> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const memoryFile = await this.findMemoryFile();
      
      if (!memoryFile) {
        return {
          entries: [],
          totalEntries: 0,
          lastModified: new Date()
        };
      }

      const response = await this.drive.files.get({
        fileId: memoryFile.id,
        alt: 'media'
      });

      const parsed = JSON.parse(response.data);
      
      return {
        ...parsed,
        lastModified: new Date(parsed.lastModified),
        entries: parsed.entries.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
          lastAccessed: new Date(entry.lastAccessed)
        }))
      };
    } catch (error) {
      if ((error as any).code === 404) {
        return {
          entries: [],
          totalEntries: 0,
          lastModified: new Date()
        };
      }
      throw new Error(`Failed to load memory from Google Drive: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  isConfigured(): boolean {
    return this.initialized && !!this.config?.refreshToken;
  }

  getStorageInfo(): string {
    return `Google Drive storage in folder: ${this.folderId || 'DeepMemory'}`;
  }

  getAuthUrl(): string {
    const scopes = ['https://www.googleapis.com/auth/drive.file'];
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes
    });
  }

  async exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; accessToken: string }> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      this.oauth2Client.setCredentials(tokens);
      
      return {
        refreshToken: tokens.refresh_token!,
        accessToken: tokens.access_token!
      };
    } catch (error) {
      throw new Error(`Failed to exchange code for tokens: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}