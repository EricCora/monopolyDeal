const COLOR_TOKEN_CLASSES: Record<string, string> = {
  any: 'is-any',
  brown: 'is-brown',
  'light blue': 'is-light-blue',
  pink: 'is-pink',
  orange: 'is-orange',
  red: 'is-red',
  yellow: 'is-yellow',
  green: 'is-green',
  'dark blue': 'is-dark-blue',
  railroad: 'is-railroad',
  utility: 'is-utility',
};

const COLOR_TOKEN_REGEX = /\b(?:Light Blue|Dark Blue|Railroad|Utility|Brown|Pink|Orange|Red|Yellow|Green|Any)\b/gi;

interface ActionLabelTextProps {
  text: string;
}

export function ActionLabelText({ text }: ActionLabelTextProps) {
  const segments = text.split(COLOR_TOKEN_REGEX);
  const matches = text.match(COLOR_TOKEN_REGEX) ?? [];

  return (
    <span className="action-label-text">
      {segments.map((segment, index) => {
        const token = matches[index];
        const tokenKey = token?.toLowerCase().replace(/\s+/g, ' ');
        const tokenClass = tokenKey ? COLOR_TOKEN_CLASSES[tokenKey] : null;
        return (
          <span key={`${segment}-${index}`}>
            {segment}
            {token ? <span className={`action-color-token ${tokenClass ?? ''}`}>{token}</span> : null}
          </span>
        );
      })}
    </span>
  );
}
