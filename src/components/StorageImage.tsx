import type { ReactNode } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { useSignedUrl } from "@/lib/storage";

type Props = {
  bucket: string;
  path: string | null;
  alt?: string;
  className?: string;
  fallback?: ReactNode;
  loading?: "eager" | "lazy";
  onClick?: () => void;
};

export function StorageImage({
  bucket,
  path,
  alt = "",
  className = "",
  fallback,
  loading = "lazy",
  onClick,
}: Props) {
  const { url, loading: pending, error } = useSignedUrl(bucket, path);

  if (pending) {
    return (
      <div className={`${className} bg-muted animate-pulse grid place-items-center`}>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className={`${className} bg-muted grid place-items-center text-muted-foreground`}>
        {fallback ?? (
          <div className="text-center p-3">
            <ImageOff className="size-5 mx-auto mb-1" />
            <div className="text-[10px]">Image unavailable</div>
          </div>
        )}
      </div>
    );
  }

  return <img src={url} alt={alt} className={className} loading={loading} onClick={onClick} />;
}
