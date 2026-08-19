import { characterEntities } from "character-entities";

const hasOwn = {}.hasOwnProperty;

/**
 * micromark 默认的实体解码实现会访问 DOM；这里只查实体表，
 * 让发布包在 Node.js 或 edge 环境导入时也能完成 SSR。
 */
export function decodeNamedCharacterReference(value: string) {
  return hasOwn.call(characterEntities, value)
    ? characterEntities[value]
    : false;
}
