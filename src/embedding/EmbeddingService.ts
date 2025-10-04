import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;
env.useBrowserCache = false;

export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private embedder: any = null;
  private modelName = 'mixedbread-ai/mxbai-embed-large-v1';
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  async initialize(): Promise<void> {
    if (this.embedder) return;
    if (this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        console.error(`Loading embedding model: ${this.modelName}...`);
          try {
            this.embedder = await pipeline('feature-extraction', this.modelName);
            console.error('Embedding model loaded successfully:', this.modelName);
          } catch (err) {
            console.error(`Failed to load model ${this.modelName}:`, err);
            // Fallback to a known supported model
            const fallbackModel = 'Xenova/all-MiniLM-L6-v2';
            console.error(`Falling back to supported embedding model: ${fallbackModel}`);
            this.modelName = fallbackModel;
            this.embedder = await pipeline('feature-extraction', this.modelName);
            console.error('Fallback embedding model loaded successfully:', this.modelName);
          }
      } catch (error) {
        console.error('Failed to load embedding model:', error);
        throw error;
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initPromise;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.embedder) {
      await this.initialize();
    }

    try {
      const maxLength = 8000;
      const truncatedText = text.length > maxLength ? text.slice(0, maxLength) : text;

      const output = await this.embedder(truncatedText, { pooling: 'mean', normalize: true });
      
      const embedding = Array.from(output.data) as number[];
      return embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.embedder) {
      await this.initialize();
    }

    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  static cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  isReady(): boolean {
    return this.embedder !== null && !this.isInitializing;
  }
}
