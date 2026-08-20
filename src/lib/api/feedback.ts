import { authFetch, unwrap } from './client'

export const MAX_FEEDBACK_IMAGES = 4
export const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024
export const FEEDBACK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export interface SubmitFeedbackInput {
  message: string
  pagePath: string
  images: File[]
}

export interface SubmitFeedbackResponse {
  id: string
  created_at: string
  attachment_count: number
}

export async function submitFeedback({
  message,
  pagePath,
  images,
}: SubmitFeedbackInput): Promise<SubmitFeedbackResponse> {
  const formData = new FormData()
  formData.set('message', message)
  formData.set('page_path', pagePath)
  images.forEach((image) => formData.append('images', image, image.name))

  const response = await authFetch('/api/feedback', {
    method: 'POST',
    body: formData,
  })

  return unwrap<SubmitFeedbackResponse>(response, 'Could not send feedback')
}
