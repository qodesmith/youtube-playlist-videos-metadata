import {
  DownloadType,
  PartialVideo,
  createFolders,
  Video,
  parseISO8601Duration,
  genExistingVideosData,
} from './utils2'
import {
  genPlaylistItems,
  genPlaylistName,
  genVideosList,
} from './youtubeApiCalls2'
import google from '@googleapis/youtube'

export async function downloadYouTubePlaylist({
  playlistId,
  apiKey,
  directory,
  fullData = false,
  maxSecondsDuration = Infinity,
  downloadData = true,
  downloadType = 'audio',
  downloadThumbnails = true,
}: {
  playlistId: string
  apiKey: string
  directory: string
  fullData?: boolean
  maxSecondsDuration?: number
  downloadType?: DownloadType
  downloadData?: boolean
  downloadThumbnails?: boolean
}) {
  // First check if we have `yt-dlp` installed on the system.
  try {
    const proc = Bun.spawnSync(['yt-dlp', '--version'])
    const hasStdout = proc.stdout.toString().length !== 0
    const hasStderr = proc.stderr.toString().length !== 0

    if (!hasStdout || hasStderr) {
      console.log('Could not find the `yt-dlp` package on this system.')
      console.log(
        'Please head to https://github.com/yt-dlp/yt-dlp for download instructions.'
      )
      process.exit(1)
    }
  } catch (e) {
    console.log('Could not find the `yt-dlp` package on this system.')
    console.log(
      'Please head to https://github.com/yt-dlp/yt-dlp for download instructions.'
    )
    process.exit(1)
  }

  const yt = google.youtube({version: 'v3', auth: apiKey})
  const playlistName = await genPlaylistName({yt, playlistId})

  const folders = createFolders({
    directory,
    playlistName,
    downloadType,
    downloadThumbnails,
  })

  const playlistItemsApiResponses = await genPlaylistItems({
    yt,
    playlistId,
    fullData,
  })

  const partialVideosData = playlistItemsApiResponses.reduce<PartialVideo[]>(
    (acc, response) => {
      response.data.items?.forEach(item => {
        const id = item.snippet?.resourceId?.videoId ?? ''
        const title = item.snippet?.title ?? ''
        const partialVideo: PartialVideo = {
          id,
          title,
          channelId: item.snippet?.videoOwnerChannelId ?? '',
          channelName: item.snippet?.videoOwnerChannelTitle ?? '',
          dateAddedToPlaylist: item.snippet?.publishedAt ?? '',
          thumbnaillUrl: item.snippet?.thumbnails?.maxres?.url ?? '',
          thumbnailPath: `${folders.thumbnails}/${id}.jpg`,
          url: `https://www.youtube.com/watch?v=${id}`,
        }

        if (item.snippet?.description === 'This video is unavailable.') {
          partialVideo.isUnavailable = true
        }

        if (downloadType === 'audio' || downloadType === 'both') {
          partialVideo.mp3Path = `${folders.audio}/${title} [${id}].mp3`
        }

        if (downloadType === 'video' || downloadType === 'both') {
          partialVideo.mp4Path = `${folders.video}/${title} [${id}].mp4`
        }

        acc.push(partialVideo)
      })

      return acc
    },
    []
  )

  const videosListApiResponses = await genVideosList({yt, partialVideosData})

  const videosData = videosListApiResponses.reduce<Video[]>(
    (acc, response, i) => {
      response.data.items?.forEach((item, j) => {
        const partialIdx = i * 50 + j
        const partialVideo = partialVideosData[partialIdx]

        // This should never happen, but just in case.
        if (!partialVideo) throw new Error('No partial video found')

        acc.push({
          ...partialVideo,
          dateCreated: item.snippet?.publishedAt ?? '',
          durationInSeconds: parseISO8601Duration(
            item.contentDetails?.duration
          ),
        })
      })

      return acc
    },
    []
  )

  const {existingAudioData, existingVideoData} = await genExistingVideosData({
    folders,
  })

  videosData.forEach(currentVideo => {
    const {id} = currentVideo
    const existingMp3Video = existingAudioData[id]
    const existingMp4Video = existingVideoData[id]

    // AUDIO - update or add the current data.
    if (existingMp3Video) {
      if (currentVideo.isUnavailable) {
        /**
         * YouTube is saying this video is unavailable - update just that field
         * in our local data, retaining all other data that the YouTube API will
         * no longer return to us.
         */
        existingMp3Video.isUnavailable = true
      } else if (existingMp3Video.isUnavailable) {
        /**
         * If a previously unavailable video is now available, update our local
         * data wholesale with the data from YouTube.
         */
        existingAudioData[id] = currentVideo
      }
    } else {
      // This is a new video that we did not have in our local data - save it.
      existingAudioData[id] = currentVideo
    }

    // VIDEO - update or add the current data.
    if (existingMp4Video) {
      if (currentVideo.isUnavailable) {
        /**
         * YouTube is saying this video is unavailable - update just that field
         * in our local data, retaining all other data that the YouTube API will
         * no longer return to us.
         */
        existingMp4Video.isUnavailable = true
      } else if (existingMp4Video.isUnavailable) {
        /**
         * If a previously unavailable video is now available, update our local
         * data wholesale with the data from YouTube.
         */
        existingVideoData[id] = currentVideo
      }
    } else {
      // This is a new video that we did not have in our local data - save it.
      existingVideoData[id] = currentVideo
    }
  })
}
