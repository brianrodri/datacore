import { Link, Literal, Literals } from "expression/literal";
import { getFileTitle } from "utils/normalizers";
import {
    FILE_TYPE,
    File,
    Indexable,
    LINKABLE_TYPE,
    LINKBEARING_TYPE,
    Linkable,
    Linkbearing,
    TAGGABLE_TYPE,
    Taggable,
} from "index/types/indexable";
import { DateTime } from "luxon";
import { Extractors, FIELDBEARING_TYPE, Field, FieldExtractor, Fieldbearing } from "../../../expression/field";
import { InlineField } from "index/import/inline-field";
import {
    FrontmatterEntry,
    LineSpan,
    JsonMarkdownPage,
    JsonMarkdownSection,
    JsonMarkdownBlock,
    JsonMarkdownListBlock,
    JsonMarkdownListItem,
    JsonMarkdownTaskItem,
} from "./json";

/** A link normalizer which takes in a raw link and produces a normalized link. */
export type LinkNormalizer = (link: Link) => Link;
export const NOOP_NORMALIZER: LinkNormalizer = (x) => x;

/** A markdown file in the vault; the source of most metadata. */
export class MarkdownPage implements File, Linkbearing, Taggable, Indexable, Fieldbearing {
    /** All of the types that a markdown file is. */
    static TYPES = [FILE_TYPE, "markdown", "page", TAGGABLE_TYPE, LINKABLE_TYPE, LINKBEARING_TYPE, FIELDBEARING_TYPE];

    // Use static types for all markdown files.
    $types: string[] = MarkdownPage.TYPES;
    $typename: string = "Page";

    // Markdown file IDs are always just the full path.
    get $id() {
        return this.$path;
    }
    // The file of a file is... it's file.
    get $file() {
        return this.$path;
    }

    /** Frontmatter values in the file, if present. Maps lower case frontmatter key -> entry. */
    $frontmatter?: Record<string, FrontmatterEntry>;
    /** Map of all distinct inline fields in the document. Maps lower case key name -> full metadata. */
    $infields: Record<string, InlineField>;

    /** The path this file exists at. */
    $path: string;
    /** Obsidian-provided date this page was created. */
    $ctime: DateTime;
    /** Obsidian-provided date this page was modified. */
    $mtime: DateTime;
    /** The extension; for markdown files, almost always '.md'. */
    $extension: string;
    /** Obsidian-provided size of this page in bytes. */
    $size: number = 0;
    /** The full extent of the file (start 0, end the number of lines in the file.) */
    $position: LineSpan;
    /** The exact tags in the file. */
    $tags: string[];
    /** All links in the file. */
    $links: Link[];
    /**
     * All child markdown sections of this markdown file. The initial section before any content is special and is
     * named with the title of the file.
     */
    $sections: MarkdownSection[] = [];

    /** Create a markdown file from the given raw values. */
    static from(raw: JsonMarkdownPage, normalizer: LinkNormalizer = NOOP_NORMALIZER): MarkdownPage {
        const sections = raw.$sections.map((sect) => MarkdownSection.from(sect, raw.$path, normalizer));

        return new MarkdownPage({
            $path: raw.$path,
            $frontmatter: raw.$frontmatter ? normalizeLinks(raw.$frontmatter, normalizer) : undefined,
            $infields: normalizeLinks(raw.$infields, normalizer),
            $ctime: DateTime.fromMillis(raw.$ctime),
            $mtime: DateTime.fromMillis(raw.$mtime),
            $extension: raw.$extension,
            $size: raw.$size,
            $position: raw.$position,
            $tags: raw.$tags,
            $links: raw.$links.map(normalizer),
            $sections: sections,
        });
    }

    private constructor(init: Partial<MarkdownPage>) {
        Object.assign(this, init);
    }

    /** Return the number of lines in the document. */
    get $lineCount() {
        return this.$position.end;
    }

    /** The name of the file. */
    get $name() {
        return getFileTitle(this.$path);
    }

    /** A link to this file. */
    get $link() {
        return Link.file(this.$path);
    }

    /** All of the indexed fields in this object. */
    get fields(): Field[] {
        return MarkdownPage.FIELD_DEF(this);
    }

    /** Get the full field definition for the given field. */
    public field(key: string): Field | undefined {
        return MarkdownPage.FIELD_DEF(this, key)?.[0];
    }

    /** Get the value for the given field. */
    public value(key: string): Literal | undefined {
        return this.field(key)?.value;
    }

    /** Convert this page into it's partial representation for saving. */
    public partial(): JsonMarkdownPage {
        return {
            $path: this.$path,
            $frontmatter: this.$frontmatter,
            $infields: this.$infields,
            $ctime: this.$ctime.toMillis(),
            $mtime: this.$mtime.toMillis(),
            $extension: this.$extension,
            $size: this.$size,
            $position: this.$position,
            $tags: this.$tags,
            $links: this.$links,
            $sections: this.$sections.map((sect) => sect.partial()),
        };
    }

    private static FIELD_DEF: FieldExtractor<MarkdownPage> = Extractors.merge(
        Extractors.intrinsics(),
        Extractors.frontmatter((f) => f.$frontmatter),
        Extractors.inlineFields((f) => f.$infields)
    );
}

export class MarkdownSection implements Indexable, Taggable, Linkable, Linkbearing, Fieldbearing {
    /** All of the types that a markdown section is. */
    static TYPES = ["markdown", "section", TAGGABLE_TYPE, LINKABLE_TYPE, LINKBEARING_TYPE, FIELDBEARING_TYPE];

    /** Path of the file that this section is in. */
    $types: string[] = MarkdownSection.TYPES;
    $typename: string = "Section";
    $id: string;
    $file: string;

    /** The index of this section in the file. */
    $ordinal: number;
    /** The title of the section; the root (implicit) section will have the title of the page. */
    $title: string;
    /** The indentation level of the section (1 - 6). */
    $level: number;
    /** The span of lines indicating the position of the section. */
    $position: LineSpan;
    /** All tags on the file. */
    $tags: string[];
    /** All links in the file. */
    $links: Link[];
    /** All of the markdown blocks in this section. */
    $blocks: MarkdownBlock[];
    /** Map of all distinct inline fields in the document, from key name -> metadata. */
    $infields: Record<string, InlineField>;

    /** Convert raw markdown section data to the appropriate class. */
    static from(raw: JsonMarkdownSection, file: string, normalizer: LinkNormalizer = NOOP_NORMALIZER): MarkdownSection {
        const blocks = raw.$blocks.map((block) => MarkdownBlock.from(block, file, normalizer));
        return new MarkdownSection({
            $file: file,
            $id: MarkdownSection.readableId(file, raw.$title, raw.$ordinal),
            $ordinal: raw.$ordinal,
            $title: raw.$title,
            $level: raw.$level,
            $position: raw.$position,
            $tags: raw.$tags,
            $links: raw.$links.map(normalizer),
            $blocks: blocks,
            $infields: normalizeLinks(raw.$infields, normalizer),
        });
    }

    private constructor(init: Partial<MarkdownSection>) {
        Object.assign(this, init);
    }

    /** Obtain the number of lines in the section. */
    get $lineCount(): number {
        return this.$position.end - this.$position.start;
    }

    /** Alias for title which allows searching over pages and sections by 'name'. */
    get $name(): string {
        return this.$title;
    }

    /** Return a link to this section. */
    get $link(): Link {
        return Link.header(this.$file, this.$title);
    }

    /** All of the indexed fields in this object. */
    get fields(): Field[] {
        return MarkdownSection.FIELD_DEF(this);
    }

    /** Fetch a specific field by key. */
    public field(key: string): Field {
        return MarkdownSection.FIELD_DEF(this, key)?.[0];
    }

    public value(key: string): Literal | undefined {
        return this.field(key)?.value;
    }

    public partial(): JsonMarkdownSection {
        return {
            $ordinal: this.$ordinal,
            $title: this.$title,
            $level: this.$level,
            $position: this.$position,
            $tags: this.$tags,
            $links: this.$links,
            $blocks: this.$blocks.map((block) => block.partial()),
            $infields: this.$infields,
        };
    }

    private static FIELD_DEF: FieldExtractor<MarkdownSection> = Extractors.merge(
        Extractors.intrinsics(),
        Extractors.inlineFields((f) => f.$infields)
    );

    /** Generate a readable ID for this section using the first 8 characters of the string and the ordinal. */
    static readableId(file: string, title: string, ordinal: number): string {
        const first8 = title.substring(0, Math.min(title.length, 8)).replace(/[^A-Za-z0-9-_]+/gi, "-");

        return `${file}/section${ordinal}/${first8}`;
    }
}

/** Base class for all markdown blocks. */
export class MarkdownBlock implements Indexable, Linkbearing, Taggable {
    static TYPES = ["markdown", "block", LINKBEARING_TYPE, TAGGABLE_TYPE];

    $types: string[] = MarkdownBlock.TYPES;
    $typename: string = "Block";
    $id: string;
    $file: string;

    /** The index of this block in the file. */
    $ordinal: number;
    /** The position/extent of the block. */
    $position: LineSpan;
    /** All tags on the block. */
    $tags: string[];
    /** All links in the file. */
    $links: Link[];
    /** Map of all distinct inline fields in the document, from key name -> metadata. */
    $infields: Record<string, InlineField>;
    /** If present, the distinct block ID for this block. */
    $blockId?: string;
    /** The type of block - paragraph, list, and so on. */
    $type: string;

    static from(object: JsonMarkdownBlock, file: string, normalizer: LinkNormalizer = NOOP_NORMALIZER): MarkdownBlock {
        if (object.$type === "list") {
            return MarkdownListBlock.from(object as JsonMarkdownListBlock, file, normalizer);
        }

        return new MarkdownBlock({
            $file: file,
            $id: MarkdownBlock.readableId(file, object.$ordinal),
            $ordinal: object.$ordinal,
            $position: object.$position,
            $tags: object.$tags,
            $links: object.$links.map(normalizer),
            $infields: normalizeLinks(object.$infields, normalizer),
            $blockId: object.$blockId,
            $type: object.$type,
        });
    }

    protected constructor(init: Partial<MarkdownBlock>) {
        Object.assign(this, init);
    }

    /** If this block has a block ID, the link to this block. */
    get $link(): Link | undefined {
        if (this.$blockId) return Link.block(this.$file, this.$blockId);
        else return undefined;
    }

    /** All of the indexed fields in this object. */
    get fields() {
        return MarkdownBlock.FIELD_DEF(this);
    }

    /** Fetch a specific field by key. */
    public field(key: string) {
        return MarkdownBlock.FIELD_DEF(this, key)?.[0];
    }

    public value(key: string): Literal | undefined {
        return this.field(key)?.value;
    }

    public partial(): JsonMarkdownBlock {
        return {
            $ordinal: this.$ordinal,
            $position: this.$position,
            $tags: this.$tags,
            $links: this.$links,
            $infields: this.$infields,
            $blockId: this.$blockId,
            $type: this.$type,
        };
    }

    private static FIELD_DEF: FieldExtractor<MarkdownBlock> = Extractors.merge(
        Extractors.intrinsics(),
        Extractors.inlineFields((f) => f.$infields)
    );

    /** Generate a readable ID for this block using the ordinal of the block. */
    static readableId(file: string, ordinal: number): string {
        return `${file}/block${ordinal}`;
    }
}

/** Special block for markdown lists (of either plain list entries or tasks). */
export class MarkdownListBlock extends MarkdownBlock implements Taggable, Linkbearing {
    static TYPES = ["markdown", "block", "block-list", TAGGABLE_TYPE, LINKBEARING_TYPE];

    $types: string[] = MarkdownListBlock.TYPES;
    $typename: string = "List Block";

    /** The list items inside of this block. */
    $elements: MarkdownListItem[];

    /** Create a list block from a serialized value. */
    static from(
        object: JsonMarkdownListBlock,
        file: string,
        normalizer: LinkNormalizer = NOOP_NORMALIZER
    ): MarkdownListBlock {
        const elements = object.$elements.map((elem) => MarkdownListItem.from(elem, file, normalizer));
        return new MarkdownListBlock({
            // TODO: This is shared with other blocks, should probably be fixed.
            $file: file,
            $id: MarkdownBlock.readableId(file, object.$ordinal),
            $ordinal: object.$ordinal,
            $position: object.$position,
            $tags: object.$tags,
            $links: object.$links.map(normalizer),
            $infields: normalizeLinks(object.$infields, normalizer),
            $blockId: object.$blockId,
            $elements: elements,
            $type: "list",
        });
    }

    public partial(): JsonMarkdownBlock {
        return Object.assign(super.partial(), {
            $elements: this.$elements.map((elem) => elem.partial()),
        });
    }

    public constructor(init: Partial<MarkdownListBlock>) {
        super(init);
    }
}

/** A specific list item in a list. */
export class MarkdownListItem implements Linkbearing, Taggable {
    static TYPES = ["markdown", "list-item", LINKBEARING_TYPE, TAGGABLE_TYPE];

    $types: string[] = MarkdownListItem.TYPES;
    $typename: string = "List Item";
    $id: string;
    $file: string;

    /** The position of the list item in the file. */
    $position: LineSpan;
    /** Child elements of this list item. */
    $elements: MarkdownListItem[];
    /** The type of list item that this element is. */
    $type: string;
    /** Exact tags on this list item. */
    $tags: string[];
    /** Map of all distinct inline fields in the document, from key name -> metadata. */
    $infields: Record<string, InlineField>;
    /** All links in the file. */
    $links: Link[];
    /** The block ID of this list item if present. */
    $blockId?: string;
    /**
     * The line number of the parent of this list item.
     * If a positive number, then this list element is a child
     * of the list element at that line.
     *
     * If a negative number, then this list element is a root element
     * of a list starting at that line (negated). I.e., -7 means
     * this is a root element of the list starting at line 7.
     */
    $parentLine: number;

    /** Create a list item from a serialized object. */
    static from(
        object: JsonMarkdownListItem,
        file: string,
        normalizer: LinkNormalizer = NOOP_NORMALIZER
    ): MarkdownListItem {
        if (object.$type === "task") return MarkdownTaskItem.from(object as JsonMarkdownTaskItem, file, normalizer);

        const elements = object.$elements.map((elem) => MarkdownListItem.from(elem, file, normalizer));
        return new MarkdownListItem({
            $file: file,
            $id: MarkdownListItem.readableId(file, object.$position.start),
            $position: object.$position,
            $elements: elements,
            $type: object.$type,
            $tags: object.$tags,
            $infields: normalizeLinks(object.$infields, normalizer),
            $links: object.$links.map(normalizer),
            $blockId: object.$blockId,
            $parentLine: object.$parentLine,
        });
    }

    protected constructor(init: Partial<MarkdownListItem>) {
        Object.assign(this, init);
    }

    /** Get the line that this list item starts on. */
    get $line(): number {
        return this.$position.start;
    }

    /** The number of lines in this list item. */
    get $lineCount(): number {
        return this.$position.end - this.$position.start + 1;
    }

    /** All of the indexed fields in this object. */
    get fields() {
        return MarkdownListItem.FIELD_DEF(this);
    }

    /** Fetch a specific field by key. */
    public field(key: string) {
        return MarkdownListItem.FIELD_DEF(this, key)?.[0];
    }

    public value(key: string): Literal | undefined {
        return this.field(key)?.value;
    }

    public partial(): JsonMarkdownListItem {
        return {
            $position: this.$position,
            $elements: this.$elements.map((elem) => elem.partial()),
            $type: this.$type,
            $tags: this.$tags,
            $infields: this.$infields,
            $links: this.$links,
            $blockId: this.$blockId,
            $parentLine: this.$parentLine,
        };
    }

    private static FIELD_DEF: FieldExtractor<MarkdownListItem> = Extractors.merge(
        Extractors.intrinsics(),
        Extractors.inlineFields((f) => f.$infields)
    );

    /** Generate a readable ID for this item using the line number. */
    static readableId(file: string, line: number): string {
        return `${file}/list${line}`;
    }
}

/** A specific task inside of a markdown list. */
export class MarkdownTaskItem extends MarkdownListItem implements Indexable, Linkbearing, Taggable {
    static TYPES = ["markdown", "list-item", "task", LINKBEARING_TYPE, TAGGABLE_TYPE];

    $types: string[] = MarkdownTaskItem.TYPES;
    $typename: string = "Task";

    /** The text inside of the task item. */
    $status: string;

    public static from(object: JsonMarkdownTaskItem, file: string, normalizer: LinkNormalizer): MarkdownTaskItem {
        const elements = object.$elements.map((elem) => MarkdownListItem.from(elem, file, normalizer));
        return new MarkdownTaskItem({
            $file: file,
            $id: MarkdownListItem.readableId(file, object.$position.start),
            $position: object.$position,
            $elements: elements,
            $type: object.$type,
            $tags: object.$tags,
            $infields: normalizeLinks(object.$infields, normalizer),
            $links: object.$links.map(normalizer),
            $blockId: object.$blockId,
            $parentLine: object.$parentLine,
            $status: object.$status,
        });
    }

    public constructor(init: Partial<MarkdownTaskItem>) {
        super(init);
    }

    public partial(): JsonMarkdownListItem {
        return Object.assign(super.partial(), {
            $status: this.$status,
        });
    }

    /** Determine if the given task is completed. */
    public get $completed() {
        return this.$status === "x" || this.$status === "X";
    }
}

/** Normalize links deeply in the object. */
function normalizeLinks<T extends Literal>(input: T, normalizer: LinkNormalizer): T {
    return Literals.mapLeaves(input, (value) => {
        if (Literals.isLink(value)) return normalizer(value);
        else return value;
    }) as T;
}
