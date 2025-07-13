<script>
    export let title;
    export let loading = false;
    export let error = null;

    function parseError(error) {
        if (!error) return "An unknown error occurred.";
        if (error.includes('429')) return "Rate limit exceeded. Please try again in a few minutes.";
        if (error.includes('404')) return "Cryptocurrency not found. Please select a different coin.";
        if (error.includes('fetch')) return "Network error. Please check your internet connection.";
        return error;
    }
</script>

<div class="card">
    <h2>{title}</h2>

    {#if loading}
        <div class="loading">
            <div class="spinner"></div>
            Loading data...
        </div>
    {:else if error}
        <div class="error-message">
            <div class="error-icon">⚠️</div>
            <div class="error-text">
                <strong>Data unavailable</strong>
                <div class="error-details">{parseError(error)}</div>
            </div>
        </div>
    {:else}
        <slot />
    {/if}
</div>

<style>
    .card {
        background: var(--bg-secondary);
        padding: 1.5rem;
        border-radius: 8px;
        border: 1px solid var(--border-color);
    }

    h2 {
        color: var(--text-primary);
        margin: 0 0 1rem 0;
        font-size: 1.3rem;
    }

    .loading {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 2rem;
        font-size: 1.1rem;
        color: var(--text-secondary);
        flex-direction: column;
        gap: 1rem;
    }

    .spinner {
        width: 24px;
        height: 24px;
        border: 3px solid var(--border-color);
        border-top: 3px solid var(--accent-color);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }

    .error-message {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1.5rem;
        background-color: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #991b1b;
        margin: 1rem 0;
    }

    .dark-theme .error-message {
        background-color: #431a1a;
        border-color: #7f2020;
        color: #fca5a5;
    }

    .error-icon {
        font-size: 1.2rem;
        flex-shrink: 0;
    }

    .error-text {
        flex: 1;
    }

    .error-text strong {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: 600;
    }

    .error-details {
        font-size: 0.9rem;
        opacity: 0.8;
    }
</style>
