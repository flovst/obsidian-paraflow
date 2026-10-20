import { getLanguage } from 'obsidian';
import { en } from './en.js';
import { zhCN } from './zh-CN.js';

export type MessageKey = keyof typeof en;

export function translate(key: MessageKey, language = getLanguage()): string {
	return /^zh(?:[-_]|$)/iu.test(language) ? zhCN[key] : en[key];
}
