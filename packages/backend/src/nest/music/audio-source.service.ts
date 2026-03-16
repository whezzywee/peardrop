import { Injectable, Logger } from '@nestjs/common'
import { AudioStream } from '@quiet/types'
import { DEFAULT_MUSIC_CONFIG } from './music.types'

interface PipedStreamResponse {
  url: string
  mimeType: string
  quality: string
  format: string
}

interface PipedVideoResponse {
  title: string
  uploader: string
  uploaderUrl: string
  thumbnailUrl: string
  duration: number
  audioStreams: PipedStreamResponse[]
}

/**
 * Resolves audio stream URLs from Piped/Invidious instances
 * Handles caching and fallback between instances
 */
@Injectable()
export class AudioSourceService {
  private readonly logger = new Logger(AudioSourceService.name)
  
  // Piped instances to try (in order)
  private readonly pipedInstances = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.r4fo.com',
  ]
  
  // Invidious instances as fallback
  private readonly invidiousInstances = [
    'https://invidious.snopyta.org',
    'https://invidious.kavin.rocks',
  ]
  
  // Cache of resolved streams
  private streamCache: Map<string, AudioStream> = new Map()
  
  private currentPipedIndex = 0
  private currentInvidiousIndex = 0

  /**
   * Resolve audio stream URL for a YouTube video ID
   */
  async resolveAudioStream(videoId: string): Promise<AudioStream | null> {
    // Check cache first
    const cached = this.streamCache.get(videoId)
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Cache hit for video ${videoId}`)
      return cached
    }

    // Try Piped instances
    const pipedResult = await this.tryPipedInstances(videoId)
    if (pipedResult) {
      this.cacheStream(videoId, pipedResult)
      return pipedResult
    }

    // Fallback to Invidious
    const invidiousResult = await this.tryInvidiousInstances(videoId)
    if (invidiousResult) {
      this.cacheStream(videoId, invidiousResult)
      return invidiousResult
    }

    this.logger.warn(`Failed to resolve audio stream for video ${videoId}`)
    return null
  }

  /**
   * Get video metadata from Piped
   */
  async getVideoMetadata(videoId: string): Promise<{ title: string; artist: string; thumbnailUrl: string; durationMs: number } | null> {
    for (let i = 0; i < this.pipedInstances.length; i++) {
      const instance = this.pipedInstances[(this.currentPipedIndex + i) % this.pipedInstances.length]
      try {
        const response = await fetch(`${instance}/streams/${videoId}`, {
          headers: {
            'Accept': 'application/json',
          },
        })
        
        if (!response.ok) continue
        
        const data = await response.json() as PipedVideoResponse
        
        return {
          title: data.title || 'Unknown Title',
          artist: data.uploader || 'Unknown Artist',
          thumbnailUrl: data.thumbnailUrl || '',
          durationMs: (data.duration || 0) * 1000,
        }
      } catch (error) {
        this.logger.debug(`Piped instance ${instance} failed: ${error}`)
      }
    }
    
    return null
  }

  private async tryPipedInstances(videoId: string): Promise<AudioStream | null> {
    for (let i = 0; i < this.pipedInstances.length; i++) {
      const instanceIndex = (this.currentPipedIndex + i) % this.pipedInstances.length
      const instance = this.pipedInstances[instanceIndex]
      
      try {
        const response = await fetch(`${instance}/streams/${videoId}`, {
          headers: {
            'Accept': 'application/json',
          },
        })
        
        if (!response.ok) {
          this.logger.debug(`Piped instance ${instance} returned ${response.status}`)
          continue
        }
        
        const data = await response.json() as PipedVideoResponse
        
        // Find best audio stream (prefer opus/webm, then aac/mp4)
        const audioStream = this.selectBestAudioStream(data.audioStreams)
        
        if (audioStream) {
          // Update preferred instance on success
          this.currentPipedIndex = instanceIndex
          
          return {
            trackId: videoId,
            streamUrl: audioStream.url,
            expiresAt: Date.now() + DEFAULT_MUSIC_CONFIG.streamCacheTtlMs,
            mimeType: audioStream.mimeType,
            quality: audioStream.quality,
          }
        }
      } catch (error) {
        this.logger.debug(`Piped instance ${instance} failed: ${error}`)
      }
    }
    
    return null
  }

  private async tryInvidiousInstances(videoId: string): Promise<AudioStream | null> {
    for (let i = 0; i < this.invidiousInstances.length; i++) {
      const instanceIndex = (this.currentInvidiousIndex + i) % this.invidiousInstances.length
      const instance = this.invidiousInstances[instanceIndex]
      
      try {
        const response = await fetch(`${instance}/api/v1/videos/${videoId}`, {
          headers: {
            'Accept': 'application/json',
          },
        })
        
        if (!response.ok) continue
        
        const data = await response.json()
        
        // Invidious has different structure
        const audioStreams = data.adaptiveFormats?.filter((f: any) => 
          f.type?.startsWith('audio/')
        ) || []
        
        if (audioStreams.length > 0) {
          const stream = audioStreams[0]
          this.currentInvidiousIndex = instanceIndex
          
          return {
            trackId: videoId,
            streamUrl: stream.url,
            expiresAt: Date.now() + DEFAULT_MUSIC_CONFIG.streamCacheTtlMs,
            mimeType: stream.type || 'audio/webm',
            quality: stream.qualityLabel || 'medium',
          }
        }
      } catch (error) {
        this.logger.debug(`Invidious instance ${instance} failed: ${error}`)
      }
    }
    
    return null
  }

  private selectBestAudioStream(streams: PipedStreamResponse[]): PipedStreamResponse | null {
    if (!streams || streams.length === 0) return null
    
    // Prefer opus/webm for best quality/size ratio
    const opus = streams.find(s => 
      s.mimeType?.includes('opus') || s.mimeType?.includes('webm')
    )
    if (opus) return opus
    
    // Then prefer aac/mp4
    const aac = streams.find(s => 
      s.mimeType?.includes('aac') || s.mimeType?.includes('mp4')
    )
    if (aac) return aac
    
    // Fallback to first available
    return streams[0]
  }

  private cacheStream(videoId: string, stream: AudioStream): void {
    this.streamCache.set(videoId, stream)
    
    // Clean up expired entries periodically
    if (this.streamCache.size > 100) {
      const now = Date.now()
      for (const [key, value] of this.streamCache.entries()) {
        if (value.expiresAt < now) {
          this.streamCache.delete(key)
        }
      }
    }
  }

  /**
   * Clear the stream cache
   */
  clearCache(): void {
    this.streamCache.clear()
  }
}
