import { AxiosError } from 'axios';
import { HttpClient } from './httpClient';

export default class MarkdownService {
    static async markupAsync(content: string, filePath: string, basePath: string): Promise<string> {
        let response = await HttpClient.postAsync(content, filePath, basePath);
        return response.data.content;
    }
}
