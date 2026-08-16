enum MemoriesViewState: Equatable { case idle, loading, success, empty, error }
enum MemoryViewState: Equatable { case loading, success, partial, error }
enum ConfirmationViewState: Equatable { case idle, saving, saved, resolved, error }
enum UploadViewState: Equatable { case idle, selected, uploading, processing, completed, partial, failed }
