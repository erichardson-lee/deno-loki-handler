import {
  BaseHandler,
  HandlerOptions,
} from "https://deno.land/std@0.178.0/log/handlers.ts";
import {
  getLogger,
  LevelName,
  LogRecord,
} from "https://deno.land/std@0.178.0/log/mod.ts";

const Logger = () => getLogger("loki-handler");

type Labels = { host?: string; [key: string]: string | undefined };
type Modes = "JSON" | "TEXT";

type ArgNames = ["ARGNAMES", ...string[]];

interface LokiHandlerOptions extends HandlerOptions {
  /** Loki Instance URL */
  url: string;

  /**
   * Enable Argument Naming
   * Allows passing an array of 'names' as the first parameter to a log call.
   * The fist value MUST be "ARGNAMES", then the rest are the names of the
   * following arguments in appearance order.
   * @example
   * ```ts
   * logger.log("Test Command Invoked", ["ARGNAMES", "command", "method"], "DoAction", "HttpRequest")
   * ```
   * @default false
   */
  enableArgNaming?: boolean;

  /**
   * The number of messages to buffer before sending
   * @default 1
   * @max 50
   * @min 1
   */
  sendBufferSize?: number;

  /** Static Labels to apply to all messages */
  labels?: Labels;

  /** What Mode to send with @default "TEXT" */
  mode?: Modes;
}

/** [TimeString, Data] */
type Entry = [string, string];

export class LokiHandler extends BaseHandler {
  private readonly sendBufferLength: number;
  private sendBuffer: Entry[];
  private sBufPtr = 0;

  protected readonly url: string;
  protected readonly labels: Labels;
  protected readonly mode: Modes;
  protected readonly enableArgNaming: boolean;

  constructor(levelName: LevelName, options: LokiHandlerOptions) {
    super(levelName, options);

    // url opt handling
    if (!Object.hasOwn(options, "url")) throw SyntaxError("Missing URL");
    this.url = options.url;

    // sendBufferSize opt handling
    if (
      Object.hasOwn(options, "sendBufferSize") &&
      (
        options.sendBufferSize! < 1 ||
        options.sendBufferSize! > 50 ||
        !Number.isInteger(options.sendBufferSize)
      )
    ) {
      throw new SyntaxError(
        `Invalid sendbuffersize (${options.sendBufferSize}) must be an integer value between 1 & 50 (inclusive)`,
      );
    }
    this.sendBufferLength = options.sendBufferSize ?? 1;
    this.sendBuffer = new Array(this.sendBufferLength);

    // labels opt handling
    this.labels = options.labels ?? { host: Deno.hostname() };

    // Mode opt handling
    this.mode = options.mode ?? "TEXT";

    // EnableArgNaming opt handling
    this.enableArgNaming = options.enableArgNaming ?? false;
  }

  private addEntry(entry: Entry): void {
    if (this.sendBufferLength === 1) {
      this.sendEntries([entry]).catch((e) => {
        Logger().critical("Error Sending entries to loki", e);
      });
    }

    this.sendBuffer[this.sBufPtr++] = entry;

    if (this.sBufPtr === this.sendBufferLength) {
      Logger().debug("Sending Entries to Loki");

      this.sendEntries(this.sendBuffer).catch((e) => {
        Logger().critical("Error Sending entries to loki", e);
      }).finally(() => {
        this.sBufPtr = 0;
      });
    }
  }

  private async sendEntries(entries: Entry[]): Promise<void> {
    //https://github.com/grafana/loki/issues/173
    //https://github.com/sleleko/devops-kb/blob/master/python/push-to-loki.py

    type ReqBody = { streams: [{ stream: Labels; values: Entry[] }] };

    const res = await fetch(`${this.url}/loki/api/v1/push`, {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify(
        {
          streams: [
            { stream: this.labels, values: entries },
          ],
        } satisfies ReqBody,
      ),
    });

    if (!res.ok) {
      throw new Error(`Failed to send data ${await res.text()}`, {
        cause: res,
      });
    }
  }

  override handle(logRecord: LogRecord): void {
    let genArgName!: (index: number) => string;

    const hasArgNames = this.enableArgNaming &&
      Array.isArray(logRecord.args[0]) &&
      logRecord.args[0][0] === "ARGNAMES";

    if (hasArgNames && Array.isArray(logRecord.args[0])) {
      const nameArr: unknown[] = logRecord.args[0];

      genArgName = (index) => {
        const label = nameArr[index];
        if (typeof label === "string") return label;
        else return `Arg${index - 1}`;
      };
    } else {
      genArgName = (index) => `Arg${index}`;
    }

    const _entries = logRecord.args.map((
      value,
      index,
    ) => [genArgName(index), JSON.stringify(value)]);

    // If has ArgNames Prop, remove it from the list
    if (hasArgNames) _entries.shift();

    const args = Object.fromEntries(_entries);

    console.log("Args", args);

    const body: Record<string, string> = {
      level: logRecord.levelName,
      text: logRecord.msg,
      ...args,
    };
    let bodyStr!: string;

    if (this.mode === "JSON") {
      bodyStr = JSON.stringify(body);
    } else if (this.mode === "TEXT") {
      bodyStr = Object.entries(body).map(([k, v]) =>
        `${k}=${JSON.stringify(v)}`
      ).join(" ");
    } else {
      throw new Error("Invalid Mode ", this.mode);
    }

    return this.addEntry([`${logRecord.datetime.getTime()}000000`, bodyStr]);
  }
}
