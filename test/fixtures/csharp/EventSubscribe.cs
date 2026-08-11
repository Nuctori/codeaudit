// InitDeity 事件订阅 + 自递归（事件不建模/自环锁定）
using System;

public sealed class EventSubscribe
{
    public event Action<int> OnLevelChanged;
    public event Action OnQuestComplete;

    public void Wire()
    {
        OnLevelChanged += HandleLevel;
        OnQuestComplete += HandleQuest;
    }

    void HandleLevel(int level)
    {
        if (level > 0) Raise(level);
    }

    void HandleQuest()
    {
        OnQuestComplete?.Invoke();
    }

    void Raise(int level)
    {
        OnLevelChanged?.Invoke(level);
    }
}
